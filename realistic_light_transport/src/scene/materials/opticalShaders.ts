import { VISIBLE_SPECTRAL_BANDS } from './spectralTransport'

// Approximate visible-light bulk IORs at aquarium temperature, not dispersion curves.
export const OPTICAL_IOR = {
  air: 1.0003,
  acrylic: 1.49,
  seawater: 1.339,
} as const

const glslNumber = (value: number): string => value.toFixed(6)
const glslRgb = (rgb: readonly [number, number, number]): string =>
  `vec3(${rgb.map(glslNumber).join(', ')})`

const volumeBandTransport = VISIBLE_SPECTRAL_BANDS.map((band, index) => `
    vec3 volumeResponse${index} = ${glslRgb(band.displayRgb)};
    float volumeTransmission${index} = exp(
      -uAttenuation * ${glslNumber(band.relativeAbsorption)} * opticalPath
    );
    transportedVolume += volumeResponse${index} * volumeTransmission${index};
    volumeWeights += volumeResponse${index};`).join('')

const surfaceBandTransport = VISIBLE_SPECTRAL_BANDS.map((band, index) => `
    vec3 bandResponse${index} = ${glslRgb(band.displayRgb)};
    float bandTransmission${index} = exp(
      -uAttenuation * ${glslNumber(band.relativeAbsorption)} * opticalPath
    );
    vec2 bandUv${index} = clamp(
      refractedUv + dispersionAxis * ${glslNumber(band.refractionOffsetUv)} * dispersionStrength,
      vec2(0.001),
      vec2(0.999)
    );
    vec3 bandScene${index} = texture2D(uSceneTexture, bandUv${index}).rgb;
    float bandSignal${index} = dot(bandScene${index}, bandResponse${index})
      / max(dot(bandResponse${index}, vec3(1.0)), 0.001);
    transportedScene += bandResponse${index} * bandSignal${index} * bandTransmission${index};
    sceneWeights += bandResponse${index};`).join('')

const spectralDiagnostic = VISIBLE_SPECTRAL_BANDS.map((band, index) => `
    if (spectralColumn == ${glslNumber(index)}) {
      diagnosticColor = ${glslRgb(band.displayRgb)} * bandTransmission${index};
    }`).join('')

const volumeSpectralDiagnostic = VISIBLE_SPECTRAL_BANDS.map((band, index) => `
    if (spectralColumn == ${glslNumber(index)}) {
      diagnosticColor = ${glslRgb(band.displayRgb)} * volumeTransmission${index};
    }`).join('')

export const waterVolumeVertexShader = /* glsl */ `
  uniform float uWaterHeight;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vDepthFromSurface;
  varying float vTankColumn;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vDepthFromSurface = clamp(0.5 - position.y / max(uWaterHeight, 0.001), 0.0, 1.0);
    vTankColumn = clamp(position.x / 5.76 + 0.5, 0.0, 0.9999);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

export const waterVolumeFragmentShader = /* glsl */ `
  uniform float uAttenuation;
  uniform float uInterfaceTransmission;
  uniform float uLightPower;
  uniform float uDiagnosticView;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vDepthFromSurface;
  varying float vTankColumn;

  void main() {
    vec3 viewRay = normalize(vWorldPosition - cameraPosition);
    float grazingPath = 1.0 / max(abs(viewRay.z), 0.3);
    float opticalPath = (0.12 + 1.1 * vDepthFromSurface) * grazingPath;

    // Six-band transport is recombined to display RGB after independent attenuation.
    vec3 transportedVolume = vec3(0.0);
    vec3 volumeWeights = vec3(0.0);
    ${volumeBandTransport}
    vec3 spectralTransmittance = transportedVolume / max(volumeWeights, vec3(0.001));
    vec3 incident = spectralTransmittance
      * (0.35 + 0.65 * uLightPower)
      * uInterfaceTransmission;
    vec3 deepScatter = vec3(0.008, 0.105, 0.15);
    vec3 radiance = mix(incident, deepScatter, 0.38 * vDepthFromSurface);

    float fresnelEdge = pow(1.0 - abs(dot(normalize(vWorldNormal), -viewRay)), 4.0);
    float alpha = 0.055 + 0.075 * vDepthFromSurface + 0.055 * fresnelEdge;

    // The transparent in-volume diagnostic keeps wavelength ordering spatially explicit.
    float spectralColumn = floor(vTankColumn * 6.0);
    vec3 diagnosticColor = vec3(0.0);
    ${volumeSpectralDiagnostic}
    if (uDiagnosticView > 0.5 && uDiagnosticView < 1.5) {
      float bandCoordinate = fract(vTankColumn * 6.0);
      float bandInterior = smoothstep(0.0, 0.055, bandCoordinate)
        * (1.0 - smoothstep(0.945, 1.0, bandCoordinate));
      diagnosticColor *= uInterfaceTransmission * (0.42 + 0.58 * uLightPower);
      radiance = mix(radiance, diagnosticColor, 0.74 * bandInterior);
      alpha = mix(alpha, 0.24, 0.72 * bandInterior);
    }
    gl_FragColor = vec4(radiance, alpha);
  }
`

export const waterSurfaceVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uFlowPower;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vWaveHeight;

  void main() {
    float flow = 0.55 + 1.35 * uFlowPower;
    float phaseA = position.x * 2.3 + uTime * flow;
    float phaseB = position.y * 3.4 - uTime * flow * 0.73;
    float waveA = sin(phaseA) * 0.030;
    float waveB = cos(phaseB) * 0.018;
    vec3 displaced = position + vec3(0.0, 0.0, waveA + waveB);

    float dzdx = cos(phaseA) * 0.069;
    float dzdy = -sin(phaseB) * 0.061;
    vec3 localNormal = normalize(vec3(-dzdx, -dzdy, 1.0));
    vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
    vWaveHeight = waveA + waveB;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

export const waterSurfaceFragmentShader = /* glsl */ `
  uniform sampler2D uSceneTexture;
  uniform float uSceneReady;
  uniform float uDiagnosticView;
  uniform float uTime;
  uniform float uLightPower;
  uniform float uInterfaceTransmission;
  uniform float uAttenuation;
  uniform vec2 uViewport;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying float vWaveHeight;

  const float AIR_IOR = 1.0003;
  const float SEAWATER_IOR = 1.339;

  void main() {
    vec3 incident = normalize(vWorldPosition - cameraPosition);
    vec3 normalDirection = normalize(vWorldNormal);
    if (dot(-incident, normalDirection) < 0.0) normalDirection *= -1.0;

    float cosTheta = clamp(dot(-incident, normalDirection), 0.0, 1.0);
    float f0 = pow((AIR_IOR - SEAWATER_IOR) / (AIR_IOR + SEAWATER_IOR), 2.0);
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
    vec3 refractedRay = refract(incident, normalDirection, AIR_IOR / SEAWATER_IOR);

    vec2 screenUv = gl_FragCoord.xy / max(uViewport, vec2(1.0));
    vec2 refractionDrift = vec2(refractedRay.x, refractedRay.y) * 0.042;
    refractionDrift += vec2(vWaveHeight * 0.34, -vWaveHeight * 0.19);
    vec2 refractedUv = clamp(screenUv + refractionDrift, vec2(0.001), vec2(0.999));
    vec2 dispersionAxis = normalize(vec2(refractedRay.x + 0.001, normalDirection.z + 0.001));
    float dispersionStrength = 0.65 + 1.1 * (1.0 - cosTheta);
    float opticalPath = 0.16 + 0.52 * (1.0 - abs(refractedRay.y));

    // This is one scene sample per band, not multi-bounce or full spectral path tracing.
    vec3 transportedScene = vec3(0.0);
    vec3 sceneWeights = vec3(0.0);
    ${surfaceBandTransport}
    transportedScene /= max(sceneWeights, vec3(0.001));
    transportedScene *= uInterfaceTransmission * (0.38 + 0.62 * uLightPower);

    // The procedural horizon remains visible until the first safe target capture completes.
    float distortedHorizon = screenUv.y + refractedRay.y * 0.13 + vWaveHeight * 1.8;
    vec3 shallowColor = vec3(0.08, 0.55, 0.72);
    vec3 deepColor = vec3(0.007, 0.11, 0.18);
    vec3 proceduralFallback = mix(
      deepColor,
      shallowColor,
      smoothstep(0.12, 0.88, distortedHorizon)
    );
    proceduralFallback *= exp(-vec3(0.21, 0.068, 0.026) * uAttenuation * opticalPath);

    vec3 refractedColor = mix(proceduralFallback, transportedScene, clamp(uSceneReady, 0.0, 1.0));
    vec3 diagnosticColor = vec3(0.0);
    float spectralColumn = floor(clamp(screenUv.x, 0.0, 0.9999) * 6.0);
    ${spectralDiagnostic}
    if (uDiagnosticView > 0.5 && uDiagnosticView < 1.5) {
      refractedColor = mix(refractedColor, diagnosticColor, 0.82);
    }

    float fineRipple = sin((screenUv.x + refractedRay.x * 0.1) * 84.0 + uTime * 1.4) * 0.018;
    vec3 reflectedSky = vec3(0.34, 0.68, 0.94) + fineRipple;
    vec3 color = mix(refractedColor, reflectedSky, clamp(fresnel * 1.8, 0.0, 0.82));
    gl_FragColor = vec4(color, 0.25 + 0.19 * fresnel);
  }
`

export const causticVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const causticFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uFlowPower;
  uniform float uLightPower;
  uniform float uInterfaceTransmission;
  varying vec2 vUv;

  void main() {
    vec2 p = (vUv - 0.5) * vec2(5.8, 2.6);
    float speed = 0.35 + 1.15 * uFlowPower;
    float layerA = sin(p.x * 4.2 + sin(p.y * 3.1 + uTime * speed));
    float layerB = sin(p.y * 5.3 - cos(p.x * 2.7 - uTime * speed * 0.83));
    float layerC = cos((p.x + p.y) * 3.5 + uTime * speed * 0.47);
    float focused = smoothstep(0.58, 0.95, abs((layerA + layerB + layerC) / 3.0));

    // Animated interference is a bounded caustic cue, not traced photon focusing.
    float energy = focused * uLightPower * uInterfaceTransmission;
    gl_FragColor = vec4(vec3(0.24, 0.78, 1.0) * energy, energy * 0.32);
  }
`
