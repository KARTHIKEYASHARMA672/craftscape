import * as THREE from 'three';
import { getBlockDef } from '../core/blocks.js';
import { getItemDef } from '../core/items.js';
import { getTileUV, renderItemIconDataUrl } from '../render/atlas.js';

function createBreakStagesTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 160; // 10 stages x 16px
  canvas.height = 16;
  const ctx = canvas.getContext('2d');

  for (let stage = 0; stage < 10; stage += 1) {
    const ox = stage * 16;
    ctx.clearRect(ox, 0, 16, 16);
    const branches = 2 + Math.floor(stage * 1.1);
    ctx.fillStyle = `rgba(10, 12, 16, ${(0.22 + stage * 0.055).toFixed(2)})`;

    // Central fracture star spreading outward with stage
    const maxLen = 2 + stage * 0.72;
    for (let b = 0; b < branches; b += 1) {
      const angle = (b / branches) * Math.PI * 2 + stage * 0.45;
      for (let r = 0; r <= maxLen; r += 0.85) {
        const px = Math.round(8 + Math.cos(angle) * r + Math.sin(r * 1.7 + b) * 0.7);
        const py = Math.round(8 + Math.sin(angle) * r + Math.cos(r * 1.5 - b) * 0.7);
        if (px >= 0 && px < 16 && py >= 0 && py < 16) {
          ctx.fillRect(ox + px, py, 1, 1);
        }
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(0.1, 1);
  tex.needsUpdate = true;
  return tex;
}

function buildTexturedCubeGeometry(def) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const uvAttr = geo.attributes.uv;

  // BoxGeometry face order: +x (east), -x (west), +y (top), -y (bottom), +z (south), -z (north)
  const faceTiles = [
    def.tiles.east,
    def.tiles.west,
    def.tiles.top,
    def.tiles.bottom,
    def.tiles.south,
    def.tiles.north,
  ];

  for (let f = 0; f < 6; f += 1) {
    const { u0, v0, u1, v1 } = getTileUV(faceTiles[f]);
    const base = f * 4;
    uvAttr.setXY(base, u0, v1);
    uvAttr.setXY(base + 1, u1, v1);
    uvAttr.setXY(base + 2, u0, v0);
    uvAttr.setXY(base + 3, u1, v0);
  }
  uvAttr.needsUpdate = true;
  return geo;
}

/**
 * Manages:
 * 1. Block target selection outline + 10-stage mining crack overlay in world space.
 * 2. Articulated 3rd-person player avatar rig (for [F5] toggle).
 * 3. Dedicated depth-cleared First-Person Viewmodel scene (never clips into nearby walls).
 */
export class ViewModelSystem {
  constructor(worldScene, atlasTexture) {
    this.worldScene = worldScene;
    this.atlasTexture = atlasTexture;

    // 1. Target block wireframe + crack progress overlay
    const wireBox = new THREE.BoxGeometry(1.005, 1.005, 1.005);
    const edges = new THREE.EdgesGeometry(wireBox);
    wireBox.dispose();
    const wireMat = new THREE.LineBasicMaterial({
      color: 0x0f1318,
      transparent: true,
      opacity: 0.78,
    });
    this.targetOutline = new THREE.LineSegments(edges, wireMat);
    this.targetOutline.visible = false;
    this.worldScene.add(this.targetOutline);

    this.crackTexture = createBreakStagesTexture();
    const crackGeo = new THREE.BoxGeometry(1.007, 1.007, 1.007);
    const crackMat = new THREE.MeshBasicMaterial({
      map: this.crackTexture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    this.crackMesh = new THREE.Mesh(crackGeo, crackMat);
    this.crackMesh.visible = false;
    this.worldScene.add(this.crackMesh);

    // 2. Third-person player character rig
    this.avatar = this._buildAvatarRig();
    this.avatar.group.visible = false;
    this.worldScene.add(this.avatar.group);

    // 3. Isolated First-Person Viewmodel overlay scene + camera
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 1, 0.05, 10);
    const vmAmbient = new THREE.HemisphereLight(0xfff6e5, 0x3b4454, 1.1);
    const vmKey = new THREE.DirectionalLight(0xffffff, 0.9);
    vmKey.position.set(1.5, 2.5, 1.8);
    this.vmScene.add(vmAmbient, vmKey);

    this.vmRoot = new THREE.Group();
    this.vmScene.add(this.vmRoot);

    this._handMesh = this._buildFirstPersonHand();
    this.vmRoot.add(this._handMesh);

    this._heldBlockMat = new THREE.MeshLambertMaterial({
      map: this.atlasTexture,
      transparent: true,
      alphaTest: 0.4,
    });
    this._heldSpriteMat = new THREE.MeshBasicMaterial({
      transparent: true,
      alphaTest: 0.25,
      side: THREE.DoubleSide,
    });
    this._heldItemMesh = null;
    this._currentItemId = null;
    this._itemTextureCache = new Map();

    this._swingTimer = 0;
    this._swingDuration = 0.22;
    this._bobPhase = 0;
  }

  _buildFirstPersonHand() {
    const geo = new THREE.BoxGeometry(0.18, 0.18, 0.56);
    const mat = new THREE.MeshLambertMaterial({ color: 0xd9a77e });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0.42, -0.34, -0.58);
    mesh.rotation.set(0.28, -0.42, 0.18);
    return mesh;
  }

  _buildAvatarRig() {
    const group = new THREE.Group();
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xdfa97d });
    const shirtMat = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
    const trimMat = new THREE.MeshLambertMaterial({ color: 0xd9a441 });
    const packMat = new THREE.MeshLambertMaterial({ color: 0x7c5736 });
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2b4b9c });
    const hairMat = new THREE.MeshLambertMaterial({ color: 0x523624 });
    const eyeMat = new THREE.MeshLambertMaterial({ color: 0x161a22 });

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 1.42, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), skinMat);
    head.position.y = 0.22;
    const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.13, 0.46), hairMat);
    hairTop.position.y = 0.39;
    const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.1), hairMat);
    hairBack.position.set(0, 0.23, 0.19);
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), eyeMat);
    eyeL.position.set(-0.1, 0.24, -0.22);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), eyeMat);
    eyeR.position.set(0.1, 0.24, -0.22);
    headPivot.add(head, hairTop, hairBack, eyeL, eyeR);
    group.add(headPivot);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.68, 0.24), shirtMat);
    torso.position.y = 1.08;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.12), packMat);
    pack.position.set(0, 1.12, 0.16);
    const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.02), trimMat);
    clasp.position.set(0, 1.18, 0.225);
    group.add(torso, pack, clasp);

    const makeLimb = (w, h, d, mat, px, py, offY) => {
      const pivot = new THREE.Group();
      pivot.position.set(px, py, 0);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.y = offY;
      pivot.add(mesh);
      group.add(pivot);
      return pivot;
    };

    const armL = makeLimb(0.18, 0.64, 0.18, shirtMat, -0.34, 1.38, -0.28);
    const armR = makeLimb(0.18, 0.64, 0.18, shirtMat, 0.34, 1.38, -0.28);
    const legL = makeLimb(0.2, 0.72, 0.2, pantsMat, -0.12, 0.72, -0.36);
    const legR = makeLimb(0.2, 0.72, 0.2, pantsMat, 0.12, 0.72, -0.36);

    return {
      group,
      headPivot,
      armL,
      armR,
      legL,
      legR,
      materials: [skinMat, shirtMat, trimMat, packMat, pantsMat, hairMat, eyeMat],
    };
  }

  triggerSwing(duration = 0.22) {
    this._swingDuration = duration;
    this._swingTimer = duration;
  }

  setHeldItem(itemId) {
    if (itemId === this._currentItemId) return;
    this._currentItemId = itemId;

    if (this._heldItemMesh) {
      this.vmRoot.remove(this._heldItemMesh);
      this._heldItemMesh.geometry?.dispose?.();
      this._heldItemMesh = null;
    }

    if (!itemId) {
      this._handMesh.visible = true;
      return;
    }

    const itemDef = getItemDef(itemId);
    if (!itemDef) {
      this._handMesh.visible = true;
      return;
    }

    this._handMesh.visible = false;

    if (itemDef.category === 'block') {
      const blockDef = getBlockDef(itemDef.blockId);
      if (blockDef.renderType === 'cross' || blockDef.renderType === 'torch') {
        this._mountSpriteMesh(itemId, 0.3);
      } else {
        const geo = buildTexturedCubeGeometry(blockDef);
        const mesh = new THREE.Mesh(geo, this._heldBlockMat);
        mesh.scale.setScalar(0.27);
        mesh.position.set(0.38, -0.29, -0.58);
        mesh.rotation.set(0.18, -0.62, 0.08);
        this.vmRoot.add(mesh);
        this._heldItemMesh = mesh;
      }
    } else {
      this._mountSpriteMesh(itemId, 0.3);
    }
  }

  _mountSpriteMesh(itemId, size) {
    let tex = this._itemTextureCache.get(itemId);
    if (!tex) {
      const dataUrl = renderItemIconDataUrl(itemId, 64);
      if (!dataUrl) {
        this._handMesh.visible = true;
        return;
      }
      tex = new THREE.TextureLoader().load(dataUrl);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      this._itemTextureCache.set(itemId, tex);
    }

    this._heldSpriteMat.map = tex;
    this._heldSpriteMat.needsUpdate = true;
    const geo = new THREE.PlaneGeometry(size, size);
    const mesh = new THREE.Mesh(geo, this._heldSpriteMat);
    mesh.position.set(0.34, -0.21, -0.58);
    mesh.rotation.set(-0.08, -0.45, -0.14);
    this.vmRoot.add(mesh);
    this._heldItemMesh = mesh;
  }

  updateTargetHighlight(hit, breakProgress = 0) {
    if (!hit) {
      this.targetOutline.visible = false;
      this.crackMesh.visible = false;
      return;
    }

    this.targetOutline.visible = true;
    this.targetOutline.position.set(hit.wx + 0.5, hit.wy + 0.5, hit.wz + 0.5);

    if (breakProgress > 0.02 && this.crackTexture) {
      const stage = Math.min(9, Math.floor(breakProgress * 10));
      this.crackTexture.offset.x = stage * 0.1;
      this.crackMesh.visible = true;
      this.crackMesh.position.set(hit.wx + 0.5, hit.wy + 0.5, hit.wz + 0.5);
    } else {
      this.crackMesh.visible = false;
    }
  }

  update({ dt, player, isMoving, thirdPerson, aspect }) {
    this.vmCamera.aspect = aspect || 1;
    this.vmCamera.updateProjectionMatrix();

    // Update First-Person Viewmodel bob & swing
    if (isMoving && player.onGround && !player.flying) {
      this._bobPhase += dt * (player.sprinting ? 11.5 : 8.2);
    } else {
      this._bobPhase += dt * 1.4;
    }

    const bobAmp = isMoving && player.onGround ? 0.022 : 0.004;
    const bobX = Math.cos(this._bobPhase * 0.5) * bobAmp;
    const bobY = Math.abs(Math.sin(this._bobPhase)) * bobAmp * 1.2;

    let swingX = 0;
    let swingY = 0;
    let swingZ = 0;
    let swingRotX = 0;
    let swingRotY = 0;
    if (this._swingTimer > 0) {
      this._swingTimer = Math.max(0, this._swingTimer - dt);
      const t = 1 - this._swingTimer / this._swingDuration;
      const arc = Math.sin(t * Math.PI);
      swingX = -arc * 0.14;
      swingY = -arc * 0.08;
      swingZ = -arc * 0.12;
      swingRotX = -arc * 0.85;
      swingRotY = arc * 0.45;
    }

    this.vmRoot.position.set(bobX + swingX, -bobY + swingY, swingZ);
    this.vmRoot.rotation.set(swingRotX, swingRotY, 0);

    // Update Third-Person Avatar Rig
    this.avatar.group.visible = Boolean(thirdPerson);
    if (thirdPerson) {
      this.avatar.group.position.set(player.position.x, player.position.y, player.position.z);
      this.avatar.group.rotation.y = player.yaw;
      this.avatar.headPivot.rotation.x = player.pitch;

      const stride = isMoving ? Math.sin(this._bobPhase) * 0.65 : 0;
      this.avatar.legL.rotation.x = stride;
      this.avatar.legR.rotation.x = -stride;
      this.avatar.armL.rotation.x = -stride * 0.7;
      this.avatar.armR.rotation.x = this._swingTimer > 0
        ? Math.sin((1 - this._swingTimer / this._swingDuration) * Math.PI) * -1.4
        : stride * 0.7;
    }
  }

  renderOverlay(renderer, showViewModel = true) {
    if (!showViewModel) return;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.vmScene, this.vmCamera);
    renderer.autoClear = prevAutoClear;
  }

  dispose() {
    this.worldScene.remove(this.targetOutline, this.crackMesh, this.avatar.group);
    this.targetOutline.geometry?.dispose?.();
    this.targetOutline.material?.dispose?.();
    this.crackMesh.geometry?.dispose?.();
    this.crackMesh.material?.dispose?.();
    this.crackTexture?.dispose?.();

    this.avatar.group.traverse((child) => {
      if (child.isMesh) child.geometry?.dispose?.();
    });
    for (const mat of this.avatar.materials) mat.dispose();

    this._handMesh.geometry?.dispose?.();
    this._handMesh.material?.dispose?.();
    this._heldItemMesh?.geometry?.dispose?.();
    this._heldBlockMat.dispose();
    this._heldSpriteMat.dispose();
    for (const tex of this._itemTextureCache.values()) tex.dispose();
    this._itemTextureCache.clear();
  }
}
