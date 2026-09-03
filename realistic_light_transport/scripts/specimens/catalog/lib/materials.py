"""Principled material construction shared by every body plan."""

from __future__ import annotations

import bpy


def principled(name: str, color, roughness: float, coat: float = 0.0, subsurface: float = 0.03,
               alpha: float | None = None, metallic: float = 0.0, emission=None, emission_strength: float = 0.0,
               specular: float = 0.4):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.use_backface_culling = False
    rgba = (*color[:3], 1.0)
    material.diffuse_color = rgba
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = rgba
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    if "Specular IOR Level" in shader.inputs:
        shader.inputs["Specular IOR Level"].default_value = specular
    if "Coat Weight" in shader.inputs:
        shader.inputs["Coat Weight"].default_value = coat
        shader.inputs["Coat Roughness"].default_value = 0.24
    if "Subsurface Weight" in shader.inputs:
        shader.inputs["Subsurface Weight"].default_value = subsurface
    if alpha is not None:
        shader.inputs["Alpha"].default_value = alpha
        if hasattr(material, "surface_render_method"):
            material.surface_render_method = "DITHERED"
    if emission is not None and "Emission Color" in shader.inputs:
        shader.inputs["Emission Color"].default_value = (*emission[:3], 1.0)
        shader.inputs["Emission Strength"].default_value = emission_strength
    return material


def attach_textures(material, albedo=None, roughness=None, normal=None, normal_strength: float = 0.3,
                    alpha_from_albedo: bool = False, vertex_color: str | None = None, emission=None,
                    emission_strength: float = 0.0):
    """Wire packed images (and an optional vertex colour multiply) into the Principled BSDF."""
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes.get("Principled BSDF")
    if albedo is not None:
        albedo_node = nodes.new("ShaderNodeTexImage")
        albedo_node.name = "Albedo"
        albedo_node.image = albedo
        color_output = albedo_node.outputs["Color"]
        if vertex_color:
            attribute = nodes.new("ShaderNodeVertexColor")
            attribute.layer_name = vertex_color
            multiply = nodes.new("ShaderNodeMix")
            multiply.data_type = "RGBA"
            multiply.blend_type = "MULTIPLY"
            multiply.inputs["Factor"].default_value = 1.0
            links.new(color_output, multiply.inputs[6])
            links.new(attribute.outputs["Color"], multiply.inputs[7])
            color_output = multiply.outputs[2]
        links.new(color_output, shader.inputs["Base Color"])
        if alpha_from_albedo:
            links.new(albedo_node.outputs["Alpha"], shader.inputs["Alpha"])
            if hasattr(material, "surface_render_method"):
                material.surface_render_method = "DITHERED"
    if roughness is not None:
        roughness_node = nodes.new("ShaderNodeTexImage")
        roughness_node.name = "Roughness"
        roughness_node.image = roughness
        links.new(roughness_node.outputs["Color"], shader.inputs["Roughness"])
    if normal is not None:
        normal_node = nodes.new("ShaderNodeTexImage")
        normal_node.name = "Normal"
        normal_node.image = normal
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.inputs["Strength"].default_value = normal_strength
        links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    if emission is not None and "Emission Color" in shader.inputs:
        emission_node = nodes.new("ShaderNodeTexImage")
        emission_node.name = "Emission"
        emission_node.image = emission
        links.new(emission_node.outputs["Color"], shader.inputs["Emission Color"])
        shader.inputs["Emission Strength"].default_value = emission_strength
    return material
