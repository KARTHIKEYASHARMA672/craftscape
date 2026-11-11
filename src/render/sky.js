import * as THREE from 'three';

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function lerpRgbHex(hexA, hexB, t) {
  const k = clamp01(t);
  const ar = (hexA >> 16) & 255;
  const ag = (hexA >> 8) & 255;
  const ab = hexA & 255;
  const br = (hexB >> 16) & 255;
  const bg = (hexB >> 8) & 255;
  const bb = hexB & 255;

  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const b = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | b;
}

/**
 * Compute deterministic sky/sun/fog/star state for timeOfDay in [0, 1).
 * 0.0 / 1.0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
 */
export function getSkyState(timeOfDay) {
  const t = ((timeOfDay % 1) + 1) % 1;
  const sunAngle = (t - 0.25) * Math.PI * 2;
  const sunElevation = Math.sin(sunAngle);

  const dayFactor = smoothstep(-0.18, 0.28, sunElevation);
  const sunIntensity = 0.16 + 0.84 * dayFactor;
  const starOpacity = 1 - smoothstep(-0.22, 0.08, sunElevation);

  const skyMix = smoothstep(-0.2, 0.35, sunElevation);
  const twilight = Math.exp(-((sunElevation / 0.24) ** 2));

  const baseSky = lerpRgbHex(0x090e1f, 0x6eb4ff, skyMix);
  const skyColorHex = lerpRgbHex(baseSky, 0xd46a4e, twilight * 0.78);

  const baseFog = lerpRgbHex(0x0e152b, 0xaed8ff, skyMix);
  const fogColorHex = lerpRgbHex(baseFog, 0xeb8846, twilight * 0.85);

  let phaseName = 'night';
  if (t >= 0.18 && t < 0.32) phaseName = 'sunrise';
  else if (t >= 0.32 && t < 0.68) phaseName = 'day';
  else if (t >= 0.68 && t < 0.82) phaseName = 'sunset';

  return {
    sunIntensity,
    skyColorHex,
    fogColorHex,
    sunAngle,
    phaseName,
    starOpacity,
  };
}

function wrapAround(value, center, span) {
  const half = span * 0.5;
  return center + ((((value - center + half) % span) + span) % span) - half;
}

function seededRand(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Dynamic celestial sky dome: sun, moon, twinkling stars, drifting voxel clouds,
 * directional/hemisphere fill lights, and underwater/horizon fog management.
 */
export class SkySystem {
  constructor(scene) {
    this.scene = scene;
    this._elapsed = 0;
    this._cloudDrift = 0;
    this._disposables = [];

    this.scene.background = new THREE.Color(0x6eb4ff);
    this.scene.fog = new THREE.Fog(0xaed8ff, 48, 96);

    this.sunLight = new THREE.DirectionalLight(0xfff6e3, 1.0);
    this.hemiLight = new THREE.HemisphereLight(0xaed8ff, 0x7a8574, 0.78);
    this.scene.add(this.sunLight, this.sunLight.target, this.hemiLight);

    this.skyGroup = new THREE.Group();
    this.scene.add(this.skyGroup);

    // Blocky Sun + soft outer glow
    const sunGeo = new THREE.PlaneGeometry(18, 18);
    const sunMat = new THREE.MeshBasicMaterial({
      color: 0xfff6bd,
      fog: false,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    const haloGeo = new THREE.PlaneGeometry(30, 30);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffcf70,
      transparent: true,
      opacity: 0.32,
      fog: false,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sunHaloMesh = new THREE.Mesh(haloGeo, haloMat);
    this.sunHaloMesh.position.z = -0.2;
    this.sunMesh.add(this.sunHaloMesh);
    this.skyGroup.add(this.sunMesh);
    this._disposables.push(sunGeo, sunMat, haloGeo, haloMat);

    // Blocky Moon
    const moonGeo = new THREE.PlaneGeometry(13, 13);
    const moonMat = new THREE.MeshBasicMaterial({
      color: 0xdce8ff,
      fog: false,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    this.skyGroup.add(this.moonMesh);
    this._disposables.push(moonGeo, moonMat);

    // Starfield dome
    const starCount = 560;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      const u = seededRand(i * 3 + 1);
      const v = seededRand(i * 3 + 2);
      const theta = u * Math.PI * 2;
      const phi = Math.acos(1 - 1.35 * v); // mostly upper hemisphere + horizon band
      const r = 185;
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi);
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.starMaterial = new THREE.PointsMaterial({
      color: 0xf4f8ff,
      size: 1.8,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      fog: false,
      depthWrite: false,
    });
    this.starPoints = new THREE.Points(starGeo, this.starMaterial);
    this.skyGroup.add(this.starPoints);
    this._disposables.push(starGeo, this.starMaterial);

    // Drifting blocky voxel clouds
    this.cloudSpan = 360;
    this.cloudDefs = [];
    for (let i = 0; i < 48; i += 1) {
      this.cloudDefs.push({
        ox: (seededRand(i * 5 + 10) - 0.5) * this.cloudSpan,
        oz: (seededRand(i * 5 + 11) - 0.5) * this.cloudSpan,
        y: 112 + Math.floor(seededRand(i * 5 + 12) * 3) * 2.5,
        sx: 12 + Math.floor(seededRand(i * 5 + 13) * 14),
        sz: 8 + Math.floor(seededRand(i * 5 + 14) * 10),
      });
    }
    const cloudGeo = new THREE.BoxGeometry(1, 2.2, 1);
    this.cloudMaterial = new THREE.MeshBasicMaterial({
      color: 0xfafcff,
      transparent: true,
      opacity: 0.84,
      fog: true,
    });
    this.cloudMesh = new THREE.InstancedMesh(cloudGeo, this.cloudMaterial, this.cloudDefs.length);
    this.cloudMesh.frustumCulled = false;
    this.scene.add(this.cloudMesh);
    this._disposables.push(cloudGeo, this.cloudMaterial);

    this._dummy = new THREE.Object3D();
    this._cloudColor = new THREE.Color();
  }

  update(dt, timeOfDay, playerPos = { x: 0, y: 64, z: 0 }, fogDistance = 80, isHeadUnderwater = false) {
    const safeDt = Math.min(Math.max(dt || 0, 0), 0.1);
    this._elapsed += safeDt;
    this._cloudDrift += safeDt * 1.45;

    const state = getSkyState(timeOfDay);
    const px = playerPos?.x ?? 0;
    const py = playerPos?.y ?? 64;
    const pz = playerPos?.z ?? 0;

    this.skyGroup.position.set(px, py, pz);

    const orbitR = 175;
    const cosA = Math.cos(state.sunAngle);
    const sinA = Math.sin(state.sunAngle);

    this.sunMesh.position.set(cosA * orbitR, sinA * orbitR, -45);
    this.sunMesh.lookAt(px, py, pz);
    this.sunMesh.visible = sinA > -0.25;

    this.moonMesh.position.set(-cosA * orbitR, -sinA * orbitR, 45);
    this.moonMesh.lookAt(px, py, pz);
    this.moonMesh.visible = sinA < 0.25;

    const twinkle = 0.88 + 0.12 * Math.sin(this._elapsed * 1.8);
    this.starMaterial.opacity = state.starOpacity * twinkle;
    this.starPoints.visible = state.starOpacity > 0.02;

    if (sinA >= 0) {
      this.sunLight.position.set(px + cosA * 80, py + sinA * 80, pz - 18);
      this.sunLight.color.setHex(state.phaseName === 'sunrise' || state.phaseName === 'sunset' ? 0xffb37a : 0xfff8ea);
      this.sunLight.intensity = 0.35 + state.sunIntensity * 0.75;
    } else {
      this.sunLight.position.set(px - cosA * 80, py - sinA * 80, pz + 18);
      this.sunLight.color.setHex(0x88a8e6);
      this.sunLight.intensity = 0.28;
    }
    this.sunLight.target.position.set(px, py, pz);
    this.sunLight.target.updateMatrixWorld();

    this.hemiLight.color.setHex(state.skyColorHex);
    this.hemiLight.intensity = 0.38 + state.sunIntensity * 0.58;

    if (isHeadUnderwater) {
      this.scene.background.setHex(0x0c3c66);
      if (this.scene.fog) {
        this.scene.fog.color.setHex(0x0c3c66);
        this.scene.fog.near = 2;
        this.scene.fog.far = Math.min(24, fogDistance * 0.35);
      }
    } else {
      this.scene.background.setHex(state.skyColorHex);
      if (this.scene.fog) {
        this.scene.fog.color.setHex(state.fogColorHex);
        this.scene.fog.near = Math.max(12, fogDistance * 0.56);
        this.scene.fog.far = Math.max(24, fogDistance * 0.98);
      }
    }

    // Cloud tint and scrolling wrap around player
    this._cloudColor.setHex(0xffffff).lerp(new THREE.Color(state.fogColorHex), 0.38);
    this.cloudMaterial.color.copy(this._cloudColor);
    this.cloudMaterial.opacity = isHeadUnderwater ? 0.25 : 0.45 + state.sunIntensity * 0.4;

    for (let i = 0; i < this.cloudDefs.length; i += 1) {
      const c = this.cloudDefs[i];
      const wx = wrapAround(c.ox + this._cloudDrift, px, this.cloudSpan);
      const wz = wrapAround(c.oz, pz, this.cloudSpan);
      this._dummy.position.set(wx, c.y, wz);
      this._dummy.scale.set(c.sx, 1, c.sz);
      this._dummy.updateMatrix();
      this.cloudMesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.cloudMesh.instanceMatrix.needsUpdate = true;

    return state;
  }

  dispose() {
    this.scene?.remove(this.skyGroup, this.cloudMesh, this.sunLight, this.sunLight.target, this.hemiLight);
    for (let i = 0; i < this._disposables.length; i += 1) {
      this._disposables[i].dispose?.();
    }
    this._disposables.length = 0;
  }
}
