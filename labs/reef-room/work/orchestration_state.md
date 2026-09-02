# Reef Packet Orchestration State

Revision: `reef-packet-v1-2026-09-02`

This file is orchestration metadata, not a substantive package artifact.

## Lane State

| Lane | Role | Dispatch ID | State | Dependency | Owned artifact |
|---|---|---|---|---|---|
| RAQ-R1 | General Researcher | `/root/reef_packet_orchestrator/raq_r1_marine` | completed | none | `/Volumes/git/games/reef/work/marine_ecology_packet.md` |
| RAQ-R2 | General Researcher | `/root/reef_packet_orchestrator/raq_r2_freshwater` | completed | none | `/Volumes/git/games/reef/work/freshwater_ecology_packet.md` |
| RAQ-R3 | General Researcher | `/root/reef_packet_orchestrator/raq_r3_engineering` | completed | none | `/Volumes/git/games/reef/work/engineering_ato_par_packet.md` |
| RAQ-R4 | General Researcher | `/root/reef_packet_orchestrator/raq_r4_livestock` | completed | none | `/Volumes/git/games/reef/work/livestock_coral_microfauna_packet.md` |
| RAQ-R5 | General Researcher | `/root/reef_packet_orchestrator/raq_r5_gameplay` | completed | none | `/Volumes/git/games/reef/work/gameplay_equipment_packet.md` |
| RAQ-A0 | Aggregator | `/root/reef_packet_orchestrator/raq_a0_aggregator` | completed | RAQ-R1 through RAQ-R5 accepted | two artifacts below |
| RAQ-D1 | Drafter | `/root/reef_packet_orchestrator/raq_d1_report` | completed | RAQ-A0 accepted | `/Volumes/git/games/reef/reef_aquarium_research_packet.md` |
| RAQ-D2 | Drafter | `/root/reef_packet_orchestrator/raq_d2_model` | completed | RAQ-A0 accepted | `/Volumes/git/games/reef/simulation_parameter_model.md` |
| RAQ-D3 | Drafter | `/root/reef_packet_orchestrator/raq_d3_gameplay_spec` | completed after same-session transient-capacity recovery | RAQ-A0 accepted | `/Volumes/git/games/reef/gameplay_systems_spec.md` |
| RAQ-V1 | Reviewer | `/root/reef_packet_orchestrator/raq_v1_review` | completed GO | corrected A0 and D1 through D3 artifacts | `/Volumes/git/games/reef/work/review_findings.md` |
| RAQ-C1 | Conditional correction | prior A0 and D2 sessions | completed | V1 M-01 source mapping | source matrix, consolidated positions, parameter model |
| RAQ-C2 | Conditional correction | prior A0, D1, D2, and D3 sessions | completed | V1 M-02 salinity proxy semantics | consolidated positions and all three audience artifacts |
| RAQ-C3 | Conditional correction | prior D3 session | completed | V1 M-03 surface-state metadata | gameplay spec header |
| RAQ-F1 | Finisher / Packager | `/root/reef_packet_orchestrator/raq_f1_finisher` | completed GO_READY_FOR_HUMAN_REVIEW | V1 GO and C1-C3 accepted | `/Volumes/git/games/reef/final_package_status.md` |
| RAQ-P1 | Top-level reconciliation repair | prior A0, D1, D2, D3, V1, and F1 sessions | completed GO_READY_FOR_HUMAN_REVIEW | A0 and D1-D3 metadata repairs accepted; V1 GO; F1 reconciled | source matrix, three audience artifacts, review findings, and final package status metadata only |

## Artifact Registry

| Artifact | Producing Lane | Consumer Lanes | Evidence Revision | Surface State / Entrypoint | Validation Status | Status |
|---|---|---|---|---|---|---|
| `/Volumes/git/games/reef/work/marine_ecology_packet.md` | RAQ-R1 | RAQ-A0, RAQ-V1 | `reef-packet-v1-2026-09-02` | before_surface_ready | lane receipt accepted; SHA-256 `01a00c830afcc61cee2710e18db7104cb7baa78406c918bb6d226c3191aae554` | completed |
| `/Volumes/git/games/reef/work/freshwater_ecology_packet.md` | RAQ-R2 | RAQ-A0, RAQ-V1 | `reef-packet-v1-2026-09-02` | before_surface_ready | lane receipt accepted; SHA-256 `a26cea9d629701168301c2a74e0ec9cad025f536c200f4ca6baa682dc307033a` | completed |
| `/Volumes/git/games/reef/work/engineering_ato_par_packet.md` | RAQ-R3 | RAQ-A0, RAQ-V1 | `reef-packet-v1-2026-09-02` | before_surface_ready | lane and PAR subprobe receipts accepted; 42 links without 404/000 | completed |
| `/Volumes/git/games/reef/work/livestock_coral_microfauna_packet.md` | RAQ-R4 | RAQ-A0, RAQ-V1 | `reef-packet-v1-2026-09-02` | before_surface_ready | lane receipt accepted; 148 citations across 58 URLs | completed |
| `/Volumes/git/games/reef/work/gameplay_equipment_packet.md` | RAQ-R5 | RAQ-A0, RAQ-V1 | `reef-packet-v1-2026-09-02` | before_surface_ready | lane receipt accepted; 20 citation targets returned HTTP 200 | completed |
| `/Volumes/git/games/reef/work/consolidated_positions.md` | RAQ-A0 | RAQ-D1, RAQ-D2, RAQ-D3, RAQ-V1 | `reef-packet-v1-2026-09-02` | final_complete control | C1-C2 accepted and V1 revalidated; SHA-256 `9a55f5346a3cd3d15cbb3372f712eecbb7b27a691e937dac07b43c27bd467097` | completed |
| `/Volumes/git/games/reef/source_matrix.md` | RAQ-A0 | RAQ-D1, RAQ-D2, RAQ-D3, RAQ-V1, RAQ-F1 | `reef-packet-v1-2026-09-02` | final_complete companion | RAQ-P1 metadata repair accepted and V1 GO; SHA-256 `893c5e83301158576e9e5fba6af62dadd2a5964ef0606eafefcb4e90f3975c88` | completed |
| `/Volumes/git/games/reef/reef_aquarium_research_packet.md` | RAQ-D1 | audience, RAQ-V1, RAQ-F1 | `reef-packet-v1-2026-09-02` | final_complete real audience entrypoint | RAQ-P1 metadata repair accepted and V1 GO; SHA-256 `ffec42a56f22c0aa24e2d10eebd1369478859ff7a53e2105b4c4381169d06aea` | completed |
| `/Volumes/git/games/reef/simulation_parameter_model.md` | RAQ-D2 | audience, RAQ-V1, RAQ-F1 | `reef-packet-v1-2026-09-02` | final_complete companion | RAQ-P1 metadata repair accepted and V1 GO; SHA-256 `4c46ef4f9a89d74d98542a0ce6a7fda572e5148b74a76206dbc94f63e39d8567` | completed |
| `/Volumes/git/games/reef/gameplay_systems_spec.md` | RAQ-D3 | audience, RAQ-V1, RAQ-F1 | `reef-packet-v1-2026-09-02` | final_complete companion | RAQ-P1 metadata repair accepted and V1 GO; SHA-256 `b30a364e74662303ddab00de308de0de8b6a60e22d4e38ab15fa21e66c1e8c4f` | completed |
| `/Volumes/git/games/reef/work/review_findings.md` | RAQ-V1 | RAQ-F1 | `reef-packet-v1-2026-09-02` | package_hardening complete | RAQ-P1 revalidation GO, no findings; SHA-256 `5458996df36969a5ae3280d40ecb461cb0600cc92b6726c54ebf799d838c6174` | completed |
| `/Volumes/git/games/reef/final_package_status.md` | RAQ-F1 | audience | `reef-packet-v1-2026-09-02` | final_complete | RAQ-P1 GO_READY_FOR_HUMAN_REVIEW; SHA-256 `43c36f5c3e737237f1aabaae24d8d1a172cdfb4af990dff3021f49f529bf1dd3` | completed |

RAQ-P1 completed as a metadata-only reconciliation pass. The accepted scientific, quantitative, source, gameplay, citation, and welfare content remained locked. V1 returned GO with no findings, F1 reconciled all accepted hashes, and no automated validation remains.

## Path Supersession

The base path `/Volumes/git/weave-agents/docs/research/reef_aquarium_simulation/` is superseded. No package artifact may remain there.
