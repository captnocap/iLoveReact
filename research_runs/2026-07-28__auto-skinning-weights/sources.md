# Automatic Skinning Weight Computation for Skeletal Character Rigging
## Consolidated Source Bibliography

**Date:** 2026-07-28
**Total unique sources:** 204 (unique URLs across all ten angle files; per-angle lists below repeat shared sources in place, with the heavily shared ones tabulated at the end)
**Organized by:** Angle of origin
**Tool provenance:** Angles 01–07 — WebSearch/WebFetch; Angle 08 — real-browser reads (`browse`); Angle 09 — `git clone --depth 1` + direct source reading, WebFetch for lookups; Angle 10 — WebSearch/WebFetch triangulation.

## Angle 01 — Bone Heat / Harmonic Diffusion (Pinocchio)


- [Automatic Rigging and Animation of 3D Characters — Baran & Popović, SIGGRAPH 2007 (PDF)](https://www.cs.toronto.edu/~jacobson/seminar/baran-and-popovic-2007.pdf)
- [ACM DL record, 10.1145/1275808.1276467](https://dl.acm.org/doi/10.1145/1275808.1276467)
- [Blender source: editors/armature/meshlaplacian.cc](https://projects.blender.org/blender/blender/raw/branch/main/source/blender/editors/armature/meshlaplacian.cc)
- [Blender source: intern/eigen/intern/linear_solver.cc](https://projects.blender.org/blender/blender/raw/branch/main/intern/eigen/intern/linear_solver.cc)
- [Blender issue #45493 — Bone Heat weighting: failed (island not visible to any bones)](https://projects.blender.org/blender/blender/issues/45493)
- [Blender issue T51250 — Bone Heat Weighting: failed to find solution](https://developer.blender.org/T51250)
- [Blender Manual — Armature Parenting (With Automatic Weights)](https://docs.blender.org/manual/en/latest/animation/armatures/skinning/parenting.html)
- [Bone Glow: An Improved Method for the Assignment of Weights for Mesh Deformation — Wareham & Lasenby, AMDO 2008 (Springer)](https://link.springer.com/chapter/10.1007/978-3-540-70517-8_7)
- [Bone Glow — ACM DL record](https://dl.acm.org/doi/10.1007/978-3-540-70517-8_7)
- [Skinning: Real-time Shape Deformation, SIGGRAPH 2014 course, Part II: Automatic Skinning via Constrained Energy Optimization — Jacobson (PDF)](https://skinning.org/automatic-methods.pdf)
- [skinning.org — course hub](https://skinning.org/)
- [Geodesic voxel binding for production character meshes — Dionne & de Lasa, SCA 2013 (ACM DL)](https://dl.acm.org/doi/10.1145/2485895.2485919)
- [HeterSkinNet — arXiv 2103.10602 (classifies bone heat vs bone glow vs geodesic methods)](https://arxiv.org/pdf/2103.10602)
- [Fix "Bone Heat Weighting: Failed…" — jessyleite.dev (community, 2026)](https://jessyleite.dev/posts/blender-bone-heat-weighting-failed/)
- [pmolodo/Pinocchio — GitHub mirror of original LGPL/MIT release](https://github.com/pmolodo/Pinocchio)
- [stnoh/Pinocchio — clone of the original mit.edu autorig page](https://github.com/stnoh/Pinocchio)

## Angle 02 — Bounded Biharmonic Weights


- [Bounded Biharmonic Weights for Real-Time Deformation — Jacobson, Baran, Popović, Sorkine-Hornung, SIGGRAPH 2011 (PDF)](https://igl.ethz.ch/projects/bbw/bounded-biharmonic-weights-siggraph-2011-jacobson-et-al.pdf)
- [IGL ETH Zurich — BBW project page](https://igl.ethz.ch/projects/bbw/)
- [Bounded biharmonic weights for real-time deformation — CACM Research Highlight (2014)](https://dl.acm.org/doi/10.1145/2578850)
- [libigl tutorial — Bounded Biharmonic Weights (ch. 403)](https://libigl.github.io/tutorial/#bounded-biharmonic-weights)
- [libigl tutorial 403 main.cpp](https://github.com/libigl/libigl/blob/main/tutorial/403_BoundedBiharmonicWeights/main.cpp)
- [igl/bbw.h documented header](https://libigl.github.io/dox/bbw_8h_source.html)
- [igl/bbw.cpp implementation](https://github.com/libigl/libigl/blob/main/include/igl/bbw.cpp)
- [igl/mosek/bbw.h — MOSEK-backed variant](https://github.com/libigl/libigl/blob/main/include/igl/mosek/bbw.h)
- [TetGen 1.5 manual — WIAS Berlin](https://wias-berlin.de/software/tetgen/1.5/doc/manual/manual.pdf)
- [Tetrahedral Meshing in the Wild — Hu, Zhou, Gao, Jacobson, Zorin, Panozzo, SIGGRAPH 2018 (PDF)](https://www.cs.toronto.edu/~jacobson/images/tetrahedral-meshing-in-the-wild-siggraph-2018-compressed-hu-et-al.pdf)
- [TetWild — GitHub](https://github.com/Yixin-Hu/TetWild)
- [Fast Tetrahedral Meshing in the Wild — Hu, Schneider, Wang, Zorin, Panozzo, ACM TOG 2020](https://dl.acm.org/doi/10.1145/3386569.3392385)
- [fTetWild — GitHub](https://github.com/wildmeshing/fTetWild)
- [Smooth Shape-Aware Functions with Controlled Extrema — Jacobson, Weinkauf, Sorkine-Hornung, SGP 2012 (project page)](https://igl.ethz.ch/projects/monotonic/)
- [Fast Automatic Skinning Transformations — Jacobson, Baran, Kavan, Popović, Sorkine-Hornung, SIGGRAPH 2012 (project page)](https://igl.ethz.ch/projects/fast/)
- [Fast Automatic Skinning Transformations (PDF)](https://igl.ethz.ch/projects/fast/fast-automatic-skinning-transformations-siggraph-2012-jacobson-et-al.pdf)
- [Biharmonic Coordinates — Weber, Poranne, Gotsman, CGF 2012](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-8659.2012.03130.x)
- [Linear Subspace Design for Real-Time Shape Deformation — Wang, Jacobson, Barbič, Kavan, SIGGRAPH 2015](https://dl.acm.org/doi/10.1145/2766952)

## Angle 03 — Geodesic Voxel Binding


- [Dionne & de Lasa, "Geodesic Voxel Binding for Production Character Meshes," SCA 2013 — author PDF (Wayback)](http://web.archive.org/web/20161105065812/http://www.delasa.net/data/sca2013_voxelization.pdf)
- [Dionne & de Lasa, "Geodesic Binding for Degenerate Character Geometry Using Sparse Voxelization," IEEE TVCG 2014 — preprint (Wayback)](http://web.archive.org/web/20240416015654/https://delasa.net/data/sparse_gvb_TVCG_preprint.pdf)
- [ACM DL record, SCA 2013](https://dl.acm.org/doi/10.1145/2485895.2485919)
- [Eurographics Digital Library record](https://diglib.eg.org/items/3d3458d9-bdf2-41c7-8b84-5da16b5cd637)
- [Semantic Scholar record (SCA 2013)](https://www.semanticscholar.org/paper/Geodesic-voxel-binding-for-production-character-Dionne-Lasa/7067af25003d7f787cfc1cc400dd242d4f18d210)
- [IEEE Xplore record (TVCG 2014, DOI 10.1109/TVCG.2014.2321563)](https://ieeexplore.ieee.org/document/6809992)
- [Maya 2023: Bind smooth skin with Geodesic Voxel binding](https://help.autodesk.com/cloudhelp/2023/ENU/Maya-CharacterAnimation/files/GUID-E9FC4C94-CDEB-41DC-AF8E-95469EC69BEE.htm)
- [Maya 2022: Bind Skin Options](https://help.autodesk.com/cloudhelp/2022/ENU/Maya-CharacterAnimation/files/GUID-CF2C698A-44BB-4CA0-BCB9-DB36500DA812.htm)
- [Maya 2023: geomBind command](https://help.autodesk.com/cloudhelp/2023/ENU/Maya-Tech-Docs/CommandsPython/geomBind.html)
- [Maya 2023: Bind methods for smooth skinning](https://help.autodesk.com/cloudhelp/2023/ENU/Maya-CharacterAnimation/files/GUID-EEFC3BE1-B386-4664-BD19-8688C58D1618.htm)
- [Maya LT 2015: Geodesic Voxel binding](https://help.autodesk.com/cloudhelp/2015/ENU/MayaLT/files/GUID-5EFDB81B-E332-4D6C-B1BB-0B989AD2F2C7.htm)
- [Chris Evans, "Geodesic Voxel Binding in Maya 2015" (Wayback)](http://web.archive.org/web/20260211181529/http://www.chrisevans3d.com/pub_blog/geodesic-voxel-binding-maya-2015/)
- [RigNet GitHub (volumetric geodesic distance precompute)](https://github.com/zhan-xu/rignet)
- [RigNet: Neural Rigging for Articulated Characters (arXiv)](https://arxiv.org/pdf/2005.00559)
- [SketchPunk Labs: Voxel Geodesic AutoSkinning (CPU)](https://www.patreon.com/posts/voxel-geodesic-58597123)
- [Voxel Heat Diffuse Skinning (Blender add-on)](https://superhivemarket.com/products/voxel-heat-diffuse-skinning)
- [Unreal Engine: Skeleton Editing documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/skeleton-editing-in-unreal-engine)

## Angle 04 — Delta Mush & Post-Smoothing


- [Delta Mush: smoothing deformations while preserving detail — ACM DL (DigiPro '14)](https://dl.acm.org/doi/abs/10.1145/2633374.2633376)
- [Delta Mush — SIGGRAPH History (abstract, Talks version)](https://history.siggraph.org/learning/delta-mush-smoothing-deformations-while-preserving-detail-by-mancewicz-derksen-and-wilson/)
- [Delta Mush DigiPro presentation slides (R&H Labs) — PDF](https://pdfs.semanticscholar.org/presentation/c38f/c245a9e080b4f7f106940297b27eaf181494.pdf)
- [Semantic Scholar record confirming 4-author DigiPro citation](https://api.semanticscholar.org/graph/v1/paper/DOI:10.1145/2633374.2633376?fields=title,authors,venue,year)
- [Direct Delta Mush Skinning and Variants — EA SEED](https://www.ea.com/seed/news/siggraph2019-direct-delta-mush)
- [Direct Delta Mush and Variants — paper PDF (EA)](https://media.contentapi.ea.com/content/dam/ea/seed/presentations/direct-delta-mush-and-variants.pdf)
- [Direct Delta Mush — SIGGRAPH 2019 presentation with speaker notes (EA)](https://media.contentapi.ea.com/content/dam/ea/seed/presentations/le2019-siggraph2019-direct-delta-mush-skinning-and-variants.pdf)
- [Direct Delta Mush Skinning and Variants — SIGGRAPH History](https://history.siggraph.org/learning/direct-delta-mush-skinning-and-variants-by-le-and-lewis/)
- [DDM Skinning Compression with Continuous Examples — project page (Le)](https://binh.graphics/papers/2021s-DDMC/)
- [DDM Compression — ACM TOG 40(4), SIGGRAPH 2021](https://dl.acm.org/doi/10.1145/3450626.3459779)
- [DDM Compression — EA SEED](https://www.ea.com/seed/news/ddm-compression-with-continuous-examples)
- [Enhanced Direct Delta Mush — arXiv:2101.02798 (SA '20 poster)](https://arxiv.org/abs/2101.02798)
- [Delta Mush in Unreal Engine with the Deformer Graph — Rodolphe Vaillant](https://rodolphe-vaillant.fr/entry/162/delta-mush-in-unreal-engine-with-the-deformer-graph-break-down)
- [Maya deltaMush node — Autodesk tech docs](https://help.autodesk.com/cloudhelp/ENU/MayaCRE-Tech-Docs/Nodes/deltaMush.html)
- [Maya Delta Mush deformer — Autodesk help](https://help.autodesk.com/cloudhelp/2023/ENU/Maya-CharacterAnimation/files/GUID-139B703C-28E7-4787-8FD4-C2991BD6C990.htm)
- [Maya Smooth skin weights — Autodesk user guide](https://download.autodesk.com/global/docs/maya2014/en_us/files/Skinning_Smooth_skin_weights.htm)
- [maya-skinning-tools smooth weights context — GitHub](https://github.com/robertjoosten/maya-skinning-tools/blob/master/scripts/skinning/tools/smooth_weights_context/README.md)
- [Geodesic voxel binding for production character meshes — Dionne & de Lasa, SCA 2013](https://dl.acm.org/doi/10.1145/2485895.2485919)
- [Implicit skinning: real-time skin deformation with contact modeling — ACM TOG 32(4), SIGGRAPH 2013](https://dl.acm.org/doi/10.1145/2461912.2461960)
- [Implicit Skinning project page (Barthe/IRIT)](https://www.irit.fr/~Loic.Barthe/implicitskinning.php)
- [unity-mesh-deform-direct-delta-mush — V-Sekai, GitHub](https://github.com/V-Sekai/unity-mesh-deform-direct-delta-mush)

## Angle 05 — Neural / Learned Skinning


- [NeuroSkinning — SIGGRAPH 2019 (ACM SIGGRAPH History Archives)](https://history.siggraph.org/learning/neuroskinning-automatic-skin-binding-for-production-characters-with-deep-graph-networks-by-liu-zheng-tang-yuan-fan-et-al/)
- [FuxiCV/NeuroSkinning (GitHub)](https://github.com/FuxiCV/NeuroSkinning)
- [RigNet project page (UMass)](https://zhan-xu.github.io/rig-net/)
- [zhan-xu/RigNet (GitHub)](https://github.com/zhan-xu/RigNet)
- [RigNet quick_start.py](https://github.com/zhan-xu/RigNet/blob/master/quick_start.py)
- [V-Sekai rig_net issue #1 — dataset licensing proposal](https://github.com/V-Sekai/V-Sekai.rig_net/issues/1)
- [HeterSkinNet — arXiv:2103.10602](https://arxiv.org/abs/2103.10602)
- [HeterSkinNet — ACM DL 10.1145/3451262](https://dl.acm.org/doi/10.1145/3451262)
- [SkinningNet — CVPR 2022 Open Access](https://openaccess.thecvf.com/content/CVPR2022/html/Mosella-Montoro_SkinningNet_Two-Stream_Graph_Convolutional_Neural_Network_for_Skinning_Prediction_of_CVPR_2022_paper.html)
- [SkinningNet project page](https://imatge-upc.github.io/skinningnet/)
- [imatge-upc/skinningnet (GitHub)](https://github.com/imatge-upc/skinningnet)
- [SkinningNet — arXiv:2203.04746](https://arxiv.org/abs/2203.04746)
- [Learning Skeletal Articulations with Neural Blend Shapes — ACM TOG](https://dl.acm.org/doi/10.1145/3450626.3459852)
- [PeizhuoLi/neural-blend-shapes (GitHub)](https://github.com/PeizhuoLi/neural-blend-shapes)
- [neural-blend-shapes LICENSE (BSD 2-Clause)](https://raw.githubusercontent.com/PeizhuoLi/neural-blend-shapes/main/LICENSE)
- [Skeleton-free Pose Transfer project page](https://zycliao.com/sfpt/)
- [zycliao/skeleton-free-pose-transfer (GitHub)](https://github.com/zycliao/skeleton-free-pose-transfer)
- [SFPT LICENSE.txt (Adobe Research License)](https://raw.githubusercontent.com/zycliao/skeleton-free-pose-transfer/main/LICENSE.txt)
- [SFPT — arXiv:2208.00790](https://arxiv.org/abs/2208.00790)
- [TARig — Computers & Graphics 114 (ACM DL)](https://dl.acm.org/doi/10.1016/j.cag.2023.05.018)
- [TARig — ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0097849323000730)
- [Make-It-Animatable — arXiv:2411.18197](https://arxiv.org/abs/2411.18197)
- [Make-It-Animatable — arXiv HTML v3 (runtime/baseline tables)](https://arxiv.org/html/2411.18197v3)
- [Make-It-Animatable project page](https://jasongzy.github.io/Make-It-Animatable/)
- [jasongzy/Make-It-Animatable (GitHub, MIT)](https://github.com/jasongzy/Make-It-Animatable)
- [UniRig — arXiv:2504.12451](https://arxiv.org/abs/2504.12451)
- [VAST-AI-Research/UniRig (GitHub)](https://github.com/VAST-AI-Research/UniRig)
- [UniRig LICENSE (MIT)](https://raw.githubusercontent.com/VAST-AI-Research/UniRig/main/LICENSE)
- [UniRig — ACM TOG 10.1145/3730930](https://dl.acm.org/doi/abs/10.1145/3730930)
- [Tripo blog: VAST/Tripo introduces UniRig](https://www.tripo3d.ai/blog/unrig-automated-3d-rigging)
- [Tripo AI Auto Rigging feature page](https://www.tripo3d.ai/features/ai-auto-rigging)
- [MagicArticulate — arXiv:2502.12135](https://arxiv.org/abs/2502.12135)
- [Seed3D/MagicArticulate (GitHub, Apache-2.0)](https://github.com/Seed3D/MagicArticulate)
- [MagicArticulate project page](https://chaoyuesong.github.io/MagicArticulate/)
- [RigAnything — arXiv:2502.09615](https://arxiv.org/pdf/2502.09615)
- [Anymate — arXiv:2505.06227](https://arxiv.org/abs/2505.06227)
- [Anymate project page](https://anymate3d.github.io/)
- [Meshy: character auto-rigging workflow guide](https://www.meshy.ai/tutorials/character-auto-rigging-workflow)
- [Meshy Rigging API docs](https://docs.meshy.ai/en/api/rigging-and-animation)
- [Anything World home (everythinguniver.se)](https://everythinguniver.se/old-home)
- [CG Channel: Unity discontinues the Ziva products](https://www.cgchannel.com/2024/04/unity-discontinues-the-ziva-products/)
- [UE5 ML Deformer framework docs](https://dev.epicgames.com/documentation/unreal-engine/ml-deformer-framework-in-unreal-engine)
- [UE5: How to use the Machine Learning Deformer](https://dev.epicgames.com/documentation/unreal-engine/how-to-use-the-machine-learning-deformer-in-unreal-engine)
- [HumanRig (listing seen; not deep-verified)](https://www.researchgate.net/publication/386418675_HumanRig_Learning_Automatic_Rigging_for_Humanoid_Character_in_a_Large_Scale_Dataset)

## Angle 06 — Hard Cases


- [Baran & Popović 2007 — Automatic Rigging and Animation of 3D Characters (Pinocchio), SIGGRAPH](https://people.csail.mit.edu/ibaran/papers/2007-SIGGRAPH-Pinocchio.pdf)
- [Dionne & de Lasa 2013 — Geodesic Voxel Binding for Production Character Meshes, SCA](https://dl.acm.org/doi/10.1145/2485895.2485919)
- [Jacobson, Baran, Popović, Sorkine 2011 — Bounded Biharmonic Weights for Real-Time Deformation, SIGGRAPH (via CACM reprint)](https://cacm.acm.org/research/bounded-biharmonic-weights-for-real-time-deformation/)
- [Abdrashitov, Raichstat, Monsen, Hill 2023 — Robust Skin Weights Transfer via Weight Inpainting, SIGGRAPH Asia Technical Communications (Epic Games) — preprint](https://www.dgp.toronto.edu/~rinat/projects/RobustSkinWeightsTransfer/preprint.pdf)
- [Robust Skin Weights Transfer — project page](https://www.dgp.toronto.edu/~rinat/projects/RobustSkinWeightsTransfer/index.html)
- [Robust Skin Weights Transfer — official sample code (MIT)](https://github.com/rin-23/RobustSkinWeightsTransferCode)
- [Robust Skin Weights Transfer — ACM DOI](https://dl.acm.org/doi/10.1145/3610543.3626180)
- [yamahigashi/MayaTransferInpaintWeights — unofficial Maya implementation](https://github.com/yamahigashi/MayaTransferInpaintWeights)
- [V-Sekai/godot-robust-skin-weights-transfer — Godot port](https://github.com/V-Sekai/godot-robust-skin-weights-transfer)
- [Hu et al. 2020 — Fast Tetrahedral Meshing in the Wild (fTetWild), ACM TOG](https://dl.acm.org/doi/10.1145/3386569.3392385)
- [fTetWild — arXiv:1908.03581](https://arxiv.org/abs/1908.03581)
- [wildmeshing/fTetWild — code](https://github.com/wildmeshing/fTetWild)
- [Dodik, Sitzmann, Solomon, Stein 2024 — Robust Biharmonic Skinning Using Geometric Fields, arXiv:2406.00238 / ACM TOG](https://arxiv.org/abs/2406.00238)
- [Blender issue #45493 — Bone Heat weighting failed (island visibility, dev diagnosis)](https://projects.blender.org/blender/blender/issues/45493)
- [Jessy Leite — Fix "Bone Heat Weighting: Failed..." in Blender (practitioner)](https://jessyleite.dev/posts/blender-bone-heat-weighting-failed/)
- [Autodesk Maya — Geodesic Voxel binding docs](https://help.autodesk.com/cloudhelp/2023/ENU/Maya-CharacterAnimation/files/GUID-5EFDB81B-E332-4D6C-B1BB-0B989AD2F2C7.htm)
- [Autodesk Maya — Copy smooth skin weights docs](https://help.autodesk.com/view/MAYAUL/2024/ENU/?guid=GUID-7D895BB0-1522-4388-96E0-4245127F90AB)
- [Second Life forums — copy skin weights body → clothing (practitioner)](https://community.secondlife.com/forums/topic/404716-maya-copy-skin-weights-from-mesh-body-and-overlap-with-clothing/)
- [Pan et al. 2021 — HeterSkinNet, I3D, arXiv:2103.10602](https://arxiv.org/abs/2103.10602)
- [Liu et al. 2019 — NeuroSkinning, ACM TOG](https://dl.acm.org/doi/10.1145/3306346.3322969)
- [Xu et al. 2020 — RigNet, SIGGRAPH — GitHub README (dataset + 1K–5K remesh requirement)](https://github.com/zhan-xu/RigNet)
- [RigAnything 2025 — arXiv:2502.09615 (RigNet generalization critique)](https://arxiv.org/html/2502.09615v1)
- [Anymate 2025 — arXiv:2505.06227 (rest-pose/runtime critique)](https://arxiv.org/html/2505.06227v1)
- [Adobe Mixamo FAQ — humanoid-only auto-rigger](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
- [mesh-online — Voxel Heat Diffuse Skinning add-on](https://www.mesh-online.net/voxel.html)
- [Superhive (Blender Market) — Voxel Heat Diffuse Skinning listing](https://superhivemarket.com/products/voxel-heat-diffuse-skinning)
- [Polycount — Rigging low-poly "PS1 Demake" style characters (thread title verified; body behind Cloudflare)](https://polycount.com/discussion/227452/rigging-low-poly-ps1-demake-style-characters)

## Angle 07 — Joint Placement / Skeleton Inference


- [Baran & Popović 2007 — Automatic Rigging and Animation of 3D Characters (PDF)](https://www.cs.toronto.edu/~jacobson/seminar/baran-and-popovic-2007.pdf)
- [Baran & Popović 2007a — Penalty functions supplement](http://people.csail.mit.edu/ibaran/penalty.pdf)
- [SIGGRAPH history entry for Pinocchio](https://history.siggraph.org/learning/automatic-rigging-and-animation-of-3d-characters-by-baran-and-popovic/)
- [Au, Tai, Chu, Cohen-Or, Lee 2008 — Skeleton Extraction by Mesh Contraction (ACM DL)](https://dl.acm.org/doi/10.1145/1360612.1360643)
- [Au et al. 2008 — project page (NTHU CGV)](https://cgv.cs.nthu.edu.tw/projects/Shape_Analysis/skeleton)
- [Au et al. 2008 — paper PDF (TAU mirror)](https://www.cs.tau.ac.il/~dcor/articles/2008/Skeleton-Extraction.pdf)
- [Tagliasacchi, Alhashim, Olson, Zhang 2012 — Mean Curvature Skeletons (PDF)](https://www.cs.sfu.ca/~haoz/pubs/tag_sgp12.pdf)
- [Mean Curvature Skeletons — Eurographics diglib](https://diglib.eg.org/items/7e96d6b7-c88b-4786-9e13-3ea14a534881)
- [ROSA — curve-skeleton extraction from incomplete point clouds (GitHub)](https://github.com/taiya/rosa)
- [CGAL — Triangulated Surface Mesh Skeletonization user manual](https://doc.cgal.org/latest/Surface_mesh_skeletonization/index.html)
- [Xu, Zhou, Kalogerakis, Landreth, Singh 2020 — RigNet (arXiv abs)](https://arxiv.org/abs/2005.00559)
- [RigNet project page + ModelsResource-RigNetv1 dataset](https://zhan-xu.github.io/rig-net/)
- [RigNet code (GitHub)](https://github.com/zhan-xu/RigNet)
- [Aujay, Hétroy, Lazarus, Depraz 2007 — Harmonic Skeleton for Realistic Character Animation (HAL)](https://inria.hal.science/inria-00151606v2)
- [Aujay et al. 2007 — ACM DL record](https://dl.acm.org/doi/10.5555/1272690.1272711)
- [Bharaj, Thormählen, Seidel, Theobalt 2012 — Automatically Rigging Multi-component Characters (project)](https://resources.mpi-inf.mpg.de/AutoRig/)
- [Bharaj et al. 2012 — paper PDF](https://gauravbharaj.github.io/papers/armc_eg_2012/armc_eg_2012.pdf)
- [Adobe — Upload and rig 3D characters with Mixamo](https://helpx.adobe.com/creative-cloud/help/mixamo-rigging-animation.html)
- [Adobe — Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
- [Steam/Fuse community — Mixamo marker placement (chin/wrists/elbows/knees/groin)](https://steamcommunity.com/app/257400/discussions/0/522728814506791366/)
- [Adobe community — markers for non-standard characters](https://community.adobe.com/t5/mixamo-discussions/set-markers-for-emoji-character-only-head-hands-amp-legs/m-p/11770841)
- [Loper et al. 2015 — SMPL (Semantic Scholar)](https://www.semanticscholar.org/paper/SMPL-Loper-Mahmood/919b8e78179ef0364f66790e05c5e8712fcdd66b)
- [SMPL review notes (pyHuman docs)](https://pyhuman.readthedocs.io/en/latest/notes/review_smpl.html)
- [RigAnything 2025 (arXiv 2502.09615)](https://arxiv.org/abs/2502.09615)
- [RigAnything project page](https://www.liuisabella.com/RigAnything/)
- [UniRig 2025 (arXiv 2504.12451)](https://arxiv.org/abs/2504.12451)
- [Anymate 2025 (arXiv 2505.06227)](https://arxiv.org/abs/2505.06227)
- [Tierny et al. 2006 — topological/geometrical skeleton extraction (PDF)](https://julien-tierny.github.io/stuff/papers/tierny_pg06.pdf)
- [Survey of 3D symmetry detection methods (MDPI Symmetry)](https://doi.org/10.3390/sym10070263)
- [Fast and Accurate Intrinsic Symmetry Detection (arXiv 1807.10162)](https://arxiv.org/pdf/1807.10162)

## Angle 08 — Commercial Auto-Rigger Heuristics


- [ActorCore AccuRIG product page](https://actorcore.reallusion.com/auto-rig)
- [AccuRIG 2 Online Manual — Welcome / 5-step workflow](https://manual.reallusion.com/AccuRig-2/2.0/01-welcome/welcome.htm)
- [AccuRig Online Manual — Rig Body Step](https://manual.reallusion.com/AccuRig-2/1.1/06-body-rig/body-rig.htm)
- [AccuRig Online Manual — Calibrate Step](https://manual.reallusion.com/AccuRig-2/2.0/08-check-animation/check-animation.htm)
- [AccuRig Online Manual — Fine-tuning Bone Angles](https://manual.reallusion.com/AccuRig-2/2.0/08-check-animation/fine-tuning-bone.htm)
- [Character Creator — Advanced AccuRIG](https://www.reallusion.com/character-creator/auto-rig.html)
- [Adobe Help — Upload and rig 3D characters with Mixamo](https://helpx.adobe.com/creative-cloud/help/mixamo-rigging-animation.html)
- [Adobe Help — Mixamo common questions](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
- [US 8,797,328 B2 — Automatic generation of 3D character animation from 3D meshes](https://patents.google.com/patent/US8797328B2/en)
- [US 9,305,387 B2 — Real time generation of animation-ready 3D character models](https://patents.google.com/patent/US9305387B2/en)
- [Google Patents — inventor search: Stefano Corazza (22 results, Mixamo/Adobe families incl. US 2020/0334892 A1)](https://patents.google.com/?inventor=Stefano+Corazza)
- [Maya 2023 — Interactive Skin Bind Options (bind methods, geodesic voxel, max influences)](https://help.autodesk.com/cloudhelp/2023/ENU/Maya-CharacterAnimation/files/GUID-B691D8D1-7D8D-4853-86CF-D3B75E835904.htm)
- [Reallusion forum — Accurig to UE5 adds unwanted twist bones](https://forum.reallusion.com/533482/Accurig-to-UE5-adds-unwanted-twist-bones)
- [BBMOD — Animating characters with Mixamo, Part 2 (Skeleton LOD)](https://blueburn.cz/bbmod/tutorials/animating-characters-with-mixamo/2)
- [CGDive — AccuRig: Easy Rigging for Humanoid Characters](https://cgdive.com/accurig-easy-rigging-for-humanoid-characters/)
- [Cascadeur docs — Quick Rigging Tool](https://cascadeur.com/help/general/quick_rigging_tool)

## Angle 09 — Open-Source Implementations


- [elrond79/Pinocchio](https://github.com/elrond79/Pinocchio)
- [libigl/libigl](https://github.com/libigl/libigl)
- [blender/blender (mirror of projects.blender.org)](https://github.com/blender/blender)
- [rin-23/RobustSkinWeightsTransferCode](https://github.com/rin-23/RobustSkinWeightsTransferCode)
- [Robust Skin Weights Transfer project page](https://www.dgp.toronto.edu/~rinat/projects/RobustSkinWeightsTransfer/index.html)
- [zhan-xu/RigNet](https://github.com/zhan-xu/RigNet)
- [guillaumeblanc/ozz-animation](https://github.com/guillaumeblanc/ozz-animation)
- [electronicarts/dem-bones](https://github.com/electronicarts/dem-bones)
- [dalton-omens/SSDR](https://github.com/dalton-omens/SSDR)
- [TomohikoMukai/ssdr](https://github.com/TomohikoMukai/ssdr)
- [diseraluca/DeltaMush](https://github.com/diseraluca/DeltaMush)
- [2TallTim/direct-delta-mush](https://github.com/2TallTim/direct-delta-mush)
- [meshonline/Surface-Heat-Diffuse-Skinning](https://github.com/meshonline/Surface-Heat-Diffuse-Skinning)
- [sketchpunklabs/autoskinning](https://github.com/sketchpunklabs/autoskinning)
- [Geodesic voxel binding paper page (de Lasa)](https://www.delasa.net/voxelization/)
- [PacosLelouch/MeshDeformUnity (found, not verified)](https://github.com/PacosLelouch/MeshDeformUnity)

## Angle 10 — Validation & Bad-Weight Detection


- [RigNet: Neural Rigging for Articulated Characters (project)](https://zhan-xu.github.io/rig-net/)
- [RigNet paper PDF (arXiv 2005.00559)](https://arxiv.org/pdf/2005.00559)
- [SkinningNet paper PDF (arXiv 2203.04746)](https://arxiv.org/pdf/2203.04746)
- [NeuroSkinning GitHub, FuxiCV](https://github.com/FuxiCV/NeuroSkinning)
- [HeterSkinNet (arXiv 2103.10602)](https://arxiv.org/abs/2103.10602)
- [HeterSkinNet (ACM)](https://dl.acm.org/doi/10.1145/3451262)
- [glTF 2.0 Specification — Khronos Registry](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [glTF-Validator ISSUES.md](https://github.com/KhronosGroup/glTF-Validator/blob/main/ISSUES.md)
- [Unreal Engine 5 — Skeletal Mesh Rendering Paths](https://dev.epicgames.com/documentation/unreal-engine/skeletal-mesh-rendering-paths-in-unreal-engine?lang=en-US)
- [Unity Scripting API — SkinWeights](https://docs.unity3d.com/ScriptReference/SkinWeights.html)
- [Unity Scripting API — QualitySettings.skinWeights](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/QualitySettings-skinWeights.html)
- [Bounded Biharmonic Weights — IGL ETH Zurich](https://igl.ethz.ch/projects/bbw/)
- [Robust Biharmonic Skinning Using Geometric Fields (arXiv 2406.00238)](https://arxiv.org/html/2406.00238v2)
- [Lewis, Cordner, Fong 2000 — Pose Space Deformation](https://dl.acm.org/doi/10.1145/344779.344862)
- [Skinning: Real-time Shape Deformation — SIGGRAPH 2014 course, direct methods](https://skinning.org/direct-methods.pdf)
- [Kavan et al. 2007 — Skinning with Dual Quaternions (I3D)](https://dl.acm.org/doi/10.1145/1230100.1230107)
- [Kavan et al. 2008 — Geometric Skinning with Approximate Dual Quaternion Blending (PDF)](https://users.cs.utah.edu/~ladislav/kavan08geometric/kavan08geometric.pdf)
- [Le & Hodgins 2016 — Real-time Skeletal Skinning with Optimized Centers of Rotation](https://dl.acm.org/doi/10.1145/2897824.2925959)
- [Vaillant et al. 2013 — Implicit Skinning](https://dl.acm.org/doi/10.1145/2461912.2461960)
- [Dionne & de Lasa 2013 — Geodesic Voxel Binding (SCA)](https://dl.acm.org/doi/10.1145/2485895.2485919)
- [Rohmer, Hahmann, Cani 2009 — Exact Volume Preserving Skinning with Shape Control (SCA, PDF)](https://imagine.inrialpes.fr/people/Damien.Rohmer/documents/publications/09_sca_skinning/pdf/RHC_SCA09.pdf)
- [Rohmer, Hahmann, Cani 2008 — Local Volume Preservation for Skinned Characters (CGF)](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-8659.2008.01340.x)
- [Zhang & Chen 2001 — Efficient Feature Extraction for 2D/3D Objects in Mesh Representation (ICIP, PDF)](http://chenlab.ece.cornell.edu/Publication/Cha/icip01_Cha.pdf)
- [Abdrashitov et al. 2023 — Robust Skin Weights Transfer via Weight Inpainting (preprint PDF)](https://www.dgp.toronto.edu/~rinat/projects/RobustSkinWeightsTransfer/preprint.pdf)
- [Robust Skin Weights Transfer — project page](https://www.dgp.toronto.edu/~rinat/projects/RobustSkinWeightsTransfer/index.html)
- [Autodesk Maya — bakeDeformer command](https://help.autodesk.com/cloudhelp/2023/CHS/Maya-Tech-Docs/CommandsPython/bakeDeformer.html)
- [Tiny Phoenix — Range of Motion tool in Maya](https://www.tinyphoenixgames.com/blog/range-motion-tool-maya)
- [Rigging Dojo — Mirror settings for skin weights](https://www.riggingdojo.com/2015/01/08/maya-mirror-settings-for-skin-weights/)
- [GDC Vault — Technical Art Techniques: Character Rigging and Technical Animation](https://gdcvault.com/play/1012716/Technical-Art-Techniques-Character-Rigging)

---

## Cross-Angle Source Overlap

| Source | Angles citing it |
|---|---|
| Dionne & de Lasa 2013, Geodesic Voxel Binding (ACM DL) | 1, 3, 4, 6, 10 |
| RigNet — GitHub repo (zhan-xu/RigNet) | 3, 5, 6, 7 (also read as source in 9, 10) |
| RigNet — paper PDF (arXiv 2005.00559) | 3, 7, 10 |
| RigNet — project page (zhan-xu.github.io/rig-net) | 5, 7, 10 |
| Robust Skin Weights Transfer — project page / preprint / code (Epic Games, SIGGRAPH Asia 2023) | 6, 9, 10 |
| Adobe Mixamo FAQ | 6, 7, 8 |
| HeterSkinNet (arXiv 2103.10602) | 1, 5, 6 (metrics also in 10) |
| Baran & Popović 2007 (Pinocchio) — paper PDF | 1, 6, 7 (mirrors differ: cs.toronto.edu vs people.csail.mit.edu) |
| Blender issue #45493 (bone-heat island failure) | 1, 6 |
| jessyleite.dev bone-heat failure field test | 1, 6 |
| Bounded Biharmonic Weights — IGL project page | 2, 10 |
| fTetWild — code + ACM TOG 2020 | 2, 6 |
| Adobe: Upload and rig with Mixamo (help page) | 7, 8 |
| Voxel Heat Diffuse Skinning (Blender add-on listing) | 3, 6 |
| NeuroSkinning — FuxiCV GitHub | 5, 10 |
| Implicit Skinning (Vaillant et al. 2013, ACM DL) | 4, 10 |
| UniRig (arXiv 2504.12451) | 5, 7 |
| Anymate (arXiv 2505.06227) | 5, 7 |
| RigAnything (arXiv 2502.09615) | 5, 6, 7 |
| skinning.org SIGGRAPH 2014 course notes | 1 (automatic-methods), 10 (direct-methods) |

## Source Quality Notes

- **Primary-source density is high where it matters most:** the five core algorithm angles (01–04, and 10's metrics) are anchored in the actual paper PDFs read in full — Pinocchio, BBW, both GVB papers (SCA 2013 + TVCG 2014, recovered via Wayback after the author's domain died), the R&H Delta Mush slides, the EA DDM paper+talk, and the Epic inpainting preprint. Claims from those files quote equations and constants verbatim.
- **Two seed-pointer corrections were caught by primary sources:** the weight-inpainting paper is Epic Games (not Roblox), and Unreal's Deformer Graph sample is classic iterative Delta Mush (not DDM). Angle 09 also corrected "Pinocchio is MIT" → library is LGPL-2.1, demo MIT.
- **Licenses in Angle 09 come from cloned LICENSE files, not memory** — including RigNet's verbatim dual-license line and the discovery that a popular DDM plugin has no license at all.
- **Proprietary boundaries are marked, not filled in:** Maya's shipped GVB parameters, Mixamo's current production pipeline, and AccuRIG's entire solver are explicitly flagged undocumented; the Mixamo patent (US 8,797,328 B2) is the closest public window and is treated as intent, not shipped truth.
- **Weakest evidence areas, flagged in the angle files:** low-poly (<1k tri) practice (forum bodies behind Cloudflare; norms reconstructed from excerpts), Bone Glow's exact equations (Springer paywall), studio-internal skin-QA suites (GDC Vault paywalled), and all 2025 neural benchmarks (self-reported, no independent replication).
- **Wayback links are load-bearing** for the GVB papers and the Chris Evans practitioner test — the original hosts are dead; the archived captures are the working citations.
