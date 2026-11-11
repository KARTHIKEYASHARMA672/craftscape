import * as THREE from 'three';

const MAX_PARTICLES = 360;

/**
 * Pooled single-draw-call InstancedMesh particle system for block-break chips,
 * TNT/creeper explosions, and torch flame embers.
 */
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;

    this._dummy = new THREE.Object3D();
    this._baseColor = new THREE.Color();
    this._tempColor = new THREE.Color();

    // Initialize instanceColor buffer upfront
    this.mesh.setColorAt(0, this._tempColor.setHex(0xffffff));
    this.scene?.add(this.mesh);
  }

  _pushParticle(particle) {
    if (this.particles.length >= MAX_PARTICLES) {
      // Evict oldest particle slot cleanly
      this.particles.shift();
    }
    this.particles.push(particle);
  }

  spawnBlockBreak(wx, wy, wz, colorHex = 0x8a8f96, count = 14) {
    this._baseColor.set(colorHex ?? 0x8a8f96);
    const floorY = Math.floor(wy);

    for (let i = 0; i < count; i += 1) {
      const px = wx + 0.15 + Math.random() * 0.7;
      const py = wy + 0.15 + Math.random() * 0.7;
      const pz = wz + 0.15 + Math.random() * 0.7;

      const dx = px - (wx + 0.5);
      const dz = pz - (wz + 0.5);
      const vx = dx * (3.0 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.8;
      const vy = 1.8 + Math.random() * 3.0;
      const vz = dz * (3.0 + Math.random() * 2.5) + (Math.random() - 0.5) * 1.8;

      const size = 0.08 + Math.random() * 0.09;
      const shade = 0.82 + Math.random() * 0.3;

      this._pushParticle({
        x: px,
        y: py,
        z: pz,
        vx,
        vy,
        vz,
        gravity: 18.0,
        drag: 0.96,
        floorY: floorY + size * 0.5,
        bounce: 0.35,
        size,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.32,
        rx: Math.random() * Math.PI,
        ry: Math.random() * Math.PI,
        vrx: (Math.random() - 0.5) * 10,
        vry: (Math.random() - 0.5) * 10,
        r: Math.min(1, this._baseColor.r * shade),
        g: Math.min(1, this._baseColor.g * shade),
        b: Math.min(1, this._baseColor.b * shade),
      });
    }
  }

  spawnExplosion(wx, wy, wz, count = 32) {
    const palette = [0xfff08a, 0xffa826, 0xff5a1f, 0x5c6066, 0x3b3e42];
    for (let i = 0; i < count; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 3.5 + Math.random() * 7.5;
      const isSmoke = i % 3 === 0;
      const colHex = palette[isSmoke ? (3 + (i % 2)) : (i % 3)];
      this._baseColor.setHex(colHex);

      const size = isSmoke ? (0.24 + Math.random() * 0.22) : (0.14 + Math.random() * 0.14);
      this._pushParticle({
        x: wx + (Math.random() - 0.5) * 0.4,
        y: wy + (Math.random() - 0.5) * 0.4,
        z: wz + (Math.random() - 0.5) * 0.4,
        vx: Math.sin(phi) * Math.cos(theta) * speed,
        vy: Math.cos(phi) * speed + (isSmoke ? 2.2 : 1.5),
        vz: Math.sin(phi) * Math.sin(theta) * speed,
        gravity: isSmoke ? -1.8 : 11.0,
        drag: isSmoke ? 0.92 : 0.95,
        floorY: -Infinity,
        bounce: 0,
        size,
        life: 0,
        maxLife: isSmoke ? (0.65 + Math.random() * 0.45) : (0.4 + Math.random() * 0.35),
        rx: Math.random() * Math.PI,
        ry: Math.random() * Math.PI,
        vrx: (Math.random() - 0.5) * 8,
        vry: (Math.random() - 0.5) * 8,
        r: this._baseColor.r,
        g: this._baseColor.g,
        b: this._baseColor.b,
      });
    }
  }

  spawnTorchEmber(wx, wy, wz) {
    const isHot = Math.random() > 0.35;
    this._baseColor.setHex(isHot ? 0xffd24d : 0xff7a1c);
    const size = 0.045 + Math.random() * 0.035;

    this._pushParticle({
      x: wx + 0.5 + (Math.random() - 0.5) * 0.1,
      y: wy + 0.66 + Math.random() * 0.06,
      z: wz + 0.5 + (Math.random() - 0.5) * 0.1,
      vx: (Math.random() - 0.5) * 0.28,
      vy: 0.55 + Math.random() * 0.5,
      vz: (Math.random() - 0.5) * 0.28,
      gravity: -0.2,
      drag: 0.98,
      floorY: -Infinity,
      bounce: 0,
      size,
      life: 0,
      maxLife: 0.4 + Math.random() * 0.35,
      rx: 0,
      ry: 0,
      vrx: 3,
      vry: 4,
      r: this._baseColor.r,
      g: this._baseColor.g,
      b: this._baseColor.b,
    });
  }

  update(dt) {
    const safeDt = Math.min(Math.max(dt || 0, 0), 0.1);
    const damp = Math.pow(0.96, safeDt * 60);

    let writeIdx = 0;
    for (let i = 0; i < this.particles.length; i += 1) {
      const p = this.particles[i];
      p.life += safeDt;
      if (p.life >= p.maxLife) continue;

      p.vy -= p.gravity * safeDt;
      const d = p.drag === 0.96 ? damp : Math.pow(p.drag, safeDt * 60);
      p.vx *= d;
      p.vz *= d;

      p.x += p.vx * safeDt;
      p.y += p.vy * safeDt;
      p.z += p.vz * safeDt;

      if (p.bounce > 0 && p.y < p.floorY) {
        p.y = p.floorY;
        p.vy = -p.vy * p.bounce;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }

      p.rx += p.vrx * safeDt;
      p.ry += p.vry * safeDt;

      const t = p.life / p.maxLife;
      const scale = p.size * (t > 0.65 ? Math.max(0.02, 1 - (t - 0.65) / 0.35) : 1);

      this._dummy.position.set(p.x, p.y, p.z);
      this._dummy.rotation.set(p.rx, p.ry, 0);
      this._dummy.scale.set(scale, scale, scale);
      this._dummy.updateMatrix();
      this.mesh.setMatrixAt(writeIdx, this._dummy.matrix);

      this._tempColor.setRGB(p.r, p.g, p.b);
      this.mesh.setColorAt(writeIdx, this._tempColor);

      this.particles[writeIdx] = p;
      writeIdx += 1;
    }

    this.particles.length = writeIdx;
    this.mesh.count = writeIdx;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.particles.length = 0;
    this.mesh.count = 0;
    this.scene?.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
