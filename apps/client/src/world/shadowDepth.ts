import { InstancedMesh, MeshDepthMaterial, type Object3D } from 'three';

// One depth material per instancing variant. three.js otherwise renders every shadow caster with a
// single shared depth material, and alternating between instanced and plain meshes makes it
// re-derive shader parameters for every object, every frame.
const instanced = new MeshDepthMaterial();
const instancedWithColor = new MeshDepthMaterial();

/** Give every instanced shadow caster under `root` a depth material matching its variant. */
export function assignShadowDepthMaterials(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof InstancedMesh) || !object.castShadow) return;
    object.customDepthMaterial = object.instanceColor ? instancedWithColor : instanced;
  });
}
