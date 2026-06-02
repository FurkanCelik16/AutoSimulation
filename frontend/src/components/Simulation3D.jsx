// src/components/Simulation3D.jsx
import React, { useRef, useMemo, useState, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Sky, useGLTF, Html } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

// ─── PROCEDURAL TEXTURE GENERATORS (HIGH REALISM) ───

// Realistic Asphalt Texture (Dark, granular road surface)
const createAsphaltTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  // Base dark gray asphalt
  ctx.fillStyle = '#2d3748'; // Cool gray 700
  ctx.fillRect(0, 0, 256, 256);

  // Granular noise for stones and wear
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const size = Math.random() * 1.5;
    ctx.fillStyle = Math.random() > 0.5 ? '#1a202c' : '#4a5568';
    ctx.fillRect(x, y, size, size);
  }

  // Fine dirt patches
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const radius = 5 + Math.random() * 15;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, 'rgba(26,32,44,0.15)');
    grad.addColorStop(1, 'rgba(26,32,44,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  return texture;
};

// Realistic Grass Texture (Lush green lawn with soil variance)
const createGrassTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#22543d'; // Forest green
  ctx.fillRect(0, 0, 128, 128);

  // Grass blades variance
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const size = Math.random() * 2.5;
    ctx.fillStyle = Math.random() > 0.4 ? '#2f855a' : '#1c4532';
    ctx.fillRect(x, y, size, size);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
};

// Concrete Floor Texture for Warehouse (Grey, polished industrial floor)
const createConcreteTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4a5568'; // Industrial slate grey
  ctx.fillRect(0, 0, 256, 256);
  // Concrete noise
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const size = Math.random() * 2;
    ctx.fillStyle = Math.random() > 0.5 ? '#2d3748' : '#718096';
    ctx.fillRect(x, y, size, size);
  }
  // Safety stripes or grid segments at borders
  ctx.strokeStyle = 'rgba(214, 158, 46, 0.3)'; // Golden warning borders
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 252, 252);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
};

// Martian Sand Texture (Deep elegant terracotta sand waves)
const createMartianSandTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  
  // 1. Base Rich Martian Terracotta (Extremely smooth and eye-pleasing)
  ctx.fillStyle = '#9e4626';
  ctx.fillRect(0, 0, 512, 512);

  // 2. Draw Soft, Low-Contrast Sand Dunes (Blending seamlessly!)
  for (let d = 0; d < 8; d++) {
    const yStart = 64 + d * 64;
    
    // Smooth Linear Gradient mimicking soft shadow and sunlit sand sweeps
    const grad = ctx.createLinearGradient(0, yStart - 40, 0, yStart + 80);
    grad.addColorStop(0, 'rgba(180, 85, 48, 0.15)'); // soft warm orange highlight
    grad.addColorStop(0.5, 'rgba(120, 48, 22, 0.18)'); // soft warm shadow
    grad.addColorStop(1, 'rgba(158, 70, 38, 0.0)');   // blend back to base

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, yStart);
    // Smooth bezier curve waves that are continuous across repeats
    ctx.bezierCurveTo(128, yStart - 35, 384, yStart + 35, 512, yStart);
    ctx.lineTo(512, yStart + 80);
    ctx.lineTo(0, yStart + 80);
    ctx.closePath();
    ctx.fill();
  }

  // 3. Draw Extremely Subtle Soft Speckles (Very fine, soft sand details, no zımpara noise!)
  ctx.fillStyle = 'rgba(210, 110, 60, 0.08)';
  for (let i = 0; i < 400; i++) {
    const rx = Math.random() * 512;
    const ry = Math.random() * 512;
    const rSize = 1.0 + Math.random() * 2.0;
    ctx.fillRect(rx, ry, rSize, rSize);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
};

// Sterile Hospital Tiles Texture
const createSterileTilesTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f7fafc'; // Clean hospital white-blue
  ctx.fillRect(0, 0, 128, 128);
  // Tile grout borders
  ctx.strokeStyle = '#e2e8f0'; 
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 128, 128);
  // Clean gloss sheen speckles
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
};

// ─── GEOMETRIC REALISTIC COMPONENTS ───

// Realistic Pine/Jungle Tree or Industrial Cargo Stacks or Martian Solar Arrays or Hospital Potted Plants
const Tree3D = ({ position, scale = 1.0, theme = 'city' }) => {
  const steamRef1 = useRef();
  const steamRef2 = useRef();
  const steamRef3 = useRef();

  useFrame(({ clock }) => {
    if (theme === 'mars') {
      const elapsed = clock.getElapsedTime();
      // Animate hydrothermal geyser steam rings
      if (steamRef1.current) {
        const p1 = (elapsed * 0.8) % 1.0;
        steamRef1.current.position.y = 0.08 + p1 * 0.6;
        steamRef1.current.scale.setScalar(0.2 + p1 * 0.8);
        steamRef1.current.material.opacity = (1.0 - p1) * 0.45;
      }
      if (steamRef2.current) {
        const p2 = (elapsed * 0.8 + 0.33) % 1.0;
        steamRef2.current.position.y = 0.08 + p2 * 0.6;
        steamRef2.current.scale.setScalar(0.2 + p2 * 0.8);
        steamRef2.current.material.opacity = (1.0 - p2) * 0.45;
      }
      if (steamRef3.current) {
        const p3 = (elapsed * 0.8 + 0.66) % 1.0;
        steamRef3.current.position.y = 0.08 + p3 * 0.6;
        steamRef3.current.scale.setScalar(0.2 + p3 * 0.8);
        steamRef3.current.material.opacity = (1.0 - p3) * 0.45;
      }
    }
  });

  if (theme === 'warehouse') {
    return (
      <group position={position} scale={[scale, scale, scale]}>
        {/* Wooden pallet base */}
        <mesh position={[0, 0.02, 0]} castShadow>
          <boxGeometry args={[0.3, 0.04, 0.3]} />
          <meshStandardMaterial color="#8b5a2b" roughness={0.9} />
        </mesh>
        {/* Metal Oil Drum */}
        <mesh position={[0.06, 0.14, 0.06]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 0.22, 10]} />
          <meshStandardMaterial color="#2d3748" metalness={0.8} roughness={0.4} />
        </mesh>
        {/* Orange Storage Crate */}
        <mesh position={[-0.06, 0.10, -0.06]} castShadow>
          <boxGeometry args={[0.10, 0.12, 0.10]} />
          <meshStandardMaterial color="#dd6b20" roughness={0.8} />
        </mesh>
      </group>
    );
  }

  if (theme === 'mars') {
    // Generate coordinate-based seed to vary models procedurally
    const seed = Math.abs(Math.floor((position[0] * 31 + position[2] * 17) * 10)) % 4;

    if (seed === 0) {
      // 🌋 1. Active Hydrothermal Volcanic Geyser (Aktif Sıcak Gaz Gayzeri)
      return (
        <group position={position} scale={[scale, scale, scale]}>
          {/* Volcanic rocky cone base */}
          <mesh castShadow>
            <cylinderGeometry args={[0.04, 0.12, 0.16, 8]} />
            <meshStandardMaterial color="#3a1608" roughness={0.9} />
          </mesh>
          {/* Vent opening */}
          <mesh position={[0, 0.081, 0]}>
            <cylinderGeometry args={[0.024, 0.024, 0.01, 8]} />
            <meshStandardMaterial color="#1a0802" />
          </mesh>
          
          {/* Steam Ring 1 (Soft orange) */}
          <mesh ref={steamRef1} position={[0, 0.08, 0]}>
            <torusGeometry args={[0.04, 0.01, 6, 16]} />
            <meshBasicMaterial color="#ff7a00" transparent opacity={0.4} blending={THREE.AdditiveBlending} />
          </mesh>
          {/* Steam Ring 2 (Organic white-grey steam cloud, no neon purple!) */}
          <mesh ref={steamRef2} position={[0, 0.08, 0]}>
            <torusGeometry args={[0.04, 0.01, 6, 16]} />
            <meshBasicMaterial color="#e0e0e0" transparent opacity={0.4} blending={THREE.AdditiveBlending} />
          </mesh>
          {/* Steam Ring 3 (Deep thermal orange) */}
          <mesh ref={steamRef3} position={[0, 0.08, 0]}>
            <torusGeometry args={[0.04, 0.01, 6, 16]} />
            <meshBasicMaterial color="#ff5500" transparent opacity={0.4} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
      );
    }
    
    if (seed === 1) {
      // 🪨 2. Volcanic Basalt Columns & Martian Rocks (Volkanik Bazalt Sütunları ve Mars Kayaları)
      return (
        <group position={position} scale={[scale, scale, scale]}>
          {/* Rocky debris base */}
          <mesh position={[0, 0.015, 0]}>
            <cylinderGeometry args={[0.09, 0.12, 0.03, 6]} />
            <meshStandardMaterial color="#3a1608" roughness={0.95} />
          </mesh>
          {/* Main vertical basalt column */}
          <mesh position={[0, 0.15, 0]} rotation={[0.04, 0.02, 0.01]} castShadow>
            <cylinderGeometry args={[0.032, 0.036, 0.30, 6]} />
            <meshStandardMaterial color="#2d3748" metalness={0.2} roughness={0.9} />
          </mesh>
          {/* Smaller slanted weathered crag */}
          <mesh position={[-0.05, 0.09, 0.03]} rotation={[-0.2, 0.1, -0.15]} castShadow>
            <cylinderGeometry args={[0.024, 0.028, 0.18, 6]} />
            <meshStandardMaterial color="#54210e" roughness={0.9} />
          </mesh>
        </group>
      );
    }

    if (seed === 2) {
      // ☄️ 3. Meteor Impact Crater (Mini Göktaşı Krateri)
      return (
        <group position={position} scale={[scale, scale, scale]}>
          {/* Elevated crater rim wall */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} castShadow receiveShadow>
            <ringGeometry args={[0.09, 0.18, 12]} />
            <meshStandardMaterial color="#8c3e1e" roughness={0.95} />
          </mesh>
          {/* Central depressed dark crater floor */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow>
            <circleGeometry args={[0.09, 12]} />
            <meshStandardMaterial color="#3a1608" roughness={0.99} />
          </mesh>
          {/* Tiny ejecta rocks scattered */}
          <mesh position={[0.13, 0.01, -0.09]} rotation={[0.5, 0.2, 0.1]} castShadow>
            <dodecahedronGeometry args={[0.02, 0]} />
            <meshStandardMaterial color="#54210e" />
          </mesh>
        </group>
      );
    }

    // 📡 4. Scientific Heliostat Solar Tracker Mirror (Güneş İzleme Aynası)
    return (
      <group position={position} scale={[scale, scale, scale]}>
        {/* Support pillar */}
        <mesh position={[0, 0.12, 0]} castShadow>
          <cylinderGeometry args={[0.01, 0.015, 0.24, 6]} />
          <meshStandardMaterial color="#cbd5e0" metalness={0.9} roughness={0.1} />
        </mesh>
        {/* Mirror mount swivel frame */}
        <mesh position={[0, 0.24, 0]} rotation={[0.4, 0.3, 0.5]} castShadow>
          <boxGeometry args={[0.22, 0.008, 0.16]} />
          <meshStandardMaterial color="#cbd5e0" metalness={0.95} roughness={0.0} /> {/* Polished mirror surface */}
        </mesh>
        {/* Blinking warm-amber status / tracking LED */}
        <mesh position={[0, 0.25, 0]}>
          <sphereGeometry args={[0.012, 6, 6]} />
          <meshBasicMaterial color="#ff9f1c" />
        </mesh>
      </group>
    );
  }

  if (theme === 'hospital') {
    return (
      <group position={position} scale={[scale * 0.9, scale * 0.9, scale * 0.9]}>
        {/* 1. Clinical Hospital Recovery Bed */}
        <group position={[0, 0.02, 0.02]}>
          {/* White metal bed frame */}
          <mesh position={[0, 0.06, 0]} castShadow>
            <boxGeometry args={[0.26, 0.02, 0.52]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.6} roughness={0.2} />
          </mesh>
          {/* Bed legs */}
          {[-0.12, 0.12].map((xVal, idx1) =>
            [-0.24, 0.24].map((zVal, idx2) => (
              <mesh key={`${idx1}-${idx2}`} position={[xVal, 0.01, zVal]} castShadow>
                <cylinderGeometry args={[0.01, 0.01, 0.08, 8]} />
                <meshStandardMaterial color="#cbd5e0" metalness={0.8} />
              </mesh>
            ))
          )}
          {/* Soft white mattress */}
          <mesh position={[0, 0.10, 0]} castShadow>
            <boxGeometry args={[0.24, 0.06, 0.50]} />
            <meshStandardMaterial color="#ffffff" roughness={0.9} />
          </mesh>
          {/* Raised pillow */}
          <mesh position={[0, 0.14, -0.19]} castShadow>
            <boxGeometry args={[0.20, 0.03, 0.09]} />
            <meshStandardMaterial color="#edf2f7" roughness={0.8} />
          </mesh>
          {/* Clinical turquoise folded sheet blanket */}
          <mesh position={[0, 0.134, 0.08]} castShadow>
            <boxGeometry args={[0.242, 0.01, 0.32]} />
            <meshStandardMaterial color="#4fd1c5" roughness={0.6} />
          </mesh>
          {/* Metal headboard & footboard bars */}
          <mesh position={[0, 0.20, -0.25]} castShadow>
            <boxGeometry args={[0.26, 0.16, 0.015]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.7} />
          </mesh>
          <mesh position={[0, 0.16, 0.25]} castShadow>
            <boxGeometry args={[0.26, 0.08, 0.015]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.7} />
          </mesh>
        </group>

        {/* 2. Chrome IV Infusion Drip Stand (Serum Askısı) */}
        <group position={[0.16, 0, -0.18]}>
          {/* Stand base plate */}
          <mesh position={[0, 0.01, 0]}>
            <cylinderGeometry args={[0.05, 0.06, 0.02, 6]} />
            <meshStandardMaterial color="#4a5568" roughness={0.6} />
          </mesh>
          {/* Chrome pole */}
          <mesh position={[0, 0.26, 0]} castShadow>
            <cylinderGeometry args={[0.006, 0.006, 0.50, 6]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.9} roughness={0.05} />
          </mesh>
          {/* Double hanger hooks */}
          <mesh position={[0, 0.50, 0]} rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[0.004, 0.10, 0.01]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.9} />
          </mesh>
          {/* Suspended IV plastic bag/bottle */}
          <mesh position={[-0.04, 0.44, 0]} castShadow>
            <cylinderGeometry args={[0.015, 0.015, 0.06, 6]} />
            <meshStandardMaterial color="#e6fffa" opacity={0.65} transparent roughness={0.05} />
          </mesh>
        </group>

        {/* 3. Light Blue Hospital Privacy Partition Curtain */}
        <mesh position={[-0.16, 0.26, 0.0]} castShadow>
          <boxGeometry args={[0.01, 0.50, 0.44]} />
          <meshStandardMaterial color="#90cdf4" opacity={0.45} transparent roughness={0.8} />
        </mesh>
      </group>
    );
  }

  // Default City Pine Tree
  return (
    <group position={position} scale={[scale, scale, scale]}>
      {/* Wood Trunk (Ağaç Gövdesi) */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.015, 0.025, 0.3, 5]} />
        <meshStandardMaterial color="#5c4033" roughness={0.9} />
      </mesh>
      {/* Foliage - Layer 1 (Bottom leaves - Koyu Yeşil) */}
      <mesh position={[0, 0.38, 0]} castShadow>
        <coneGeometry args={[0.16, 0.36, 5]} />
        <meshStandardMaterial color="#1b4332" roughness={0.8} />
      </mesh>
      {/* Foliage - Layer 2 (Top leaves - Açık Yeşil) */}
      <mesh position={[0, 0.54, 0]} castShadow>
        <coneGeometry args={[0.10, 0.22, 5]} />
        <meshStandardMaterial color="#2d6a4f" roughness={0.8} />
      </mesh>
    </group>
  );
};

// Sleek Enclosed Indoor Facility Shell (Depo ve Hastane Kapalı Duvarları ve Çelik Çatı Kirişleri)
// Sleek Enclosed Indoor Facility Shell (Depo ve Hastane Kapalı Duvarları ve Çelik Çatı Kirişleri)
const IndoorShell3D = ({ size, theme }) => {
  const half = size / 2;
  const wallHeight = 2.5;
  const ecgRef1 = useRef();
  const ecgRef2 = useRef();
  
  useFrame(({ clock }) => {
    if (theme === 'hospital') {
      const t = clock.getElapsedTime();
      // Double-thump heartbeat scale effect (Pulsating vital screens!)
      const beat = 1.0 + Math.pow(Math.sin(t * 4.5), 12.0) * 0.08;
      if (ecgRef1.current) {
        ecgRef1.current.scale.set(beat, 1.0, beat);
      }
      if (ecgRef2.current) {
        ecgRef2.current.scale.set(beat, 1.0, beat);
      }
    }
  });
  
  if (theme !== 'warehouse' && theme !== 'hospital') return null;
  
  const wallColor = theme === 'warehouse' ? '#3d4852' : '#f7fafc'; // deep metal slate grey vs clinical high white
  
  return (
    <group>
      {/* 4 Enclosing Walls */}
      {/* North Wall */}
      <mesh position={[0, wallHeight / 2, -half - 0.08]} castShadow receiveShadow>
        <boxGeometry args={[size + 0.16, wallHeight, 0.08]} />
        <meshStandardMaterial color={wallColor} roughness={theme === 'hospital' ? 0.15 : 0.85} metalness={theme === 'warehouse' ? 0.3 : 0.0} />
      </mesh>
      {/* South Wall */}
      <mesh position={[0, wallHeight / 2, half + 0.08]} castShadow receiveShadow>
        <boxGeometry args={[size + 0.16, wallHeight, 0.08]} />
        <meshStandardMaterial color={wallColor} roughness={theme === 'hospital' ? 0.15 : 0.85} metalness={theme === 'warehouse' ? 0.3 : 0.0} />
      </mesh>
      {/* West Wall */}
      <mesh position={[-half - 0.08, wallHeight / 2, 0]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[size + 0.16, wallHeight, 0.08]} />
        <meshStandardMaterial color={wallColor} roughness={theme === 'hospital' ? 0.15 : 0.85} metalness={theme === 'warehouse' ? 0.3 : 0.0} />
      </mesh>
      {/* East Wall */}
      <mesh position={[half + 0.08, wallHeight / 2, 0]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[size + 0.16, wallHeight, 0.08]} />
        <meshStandardMaterial color={wallColor} roughness={theme === 'hospital' ? 0.15 : 0.85} metalness={theme === 'warehouse' ? 0.3 : 0.0} />
      </mesh>

      {/* Warehouse specific wall trims, dock doors and columns */}
      {theme === 'warehouse' && (
        <group>
          {/* Base safety trim around walls (Yellow/Black striped effect) */}
          {[-half - 0.035, half + 0.035].map((pos, idx) => (
            <group key={idx}>
              {/* North/South base trim */}
              <mesh position={[0, 0.08, pos]} castShadow>
                <boxGeometry args={[size, 0.16, 0.015]} />
                <meshStandardMaterial color="#ecc94b" roughness={0.5} />
              </mesh>
              {/* West/East base trim */}
              <mesh position={[pos, 0.08, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
                <boxGeometry args={[size, 0.16, 0.015]} />
                <meshStandardMaterial color="#ecc94b" roughness={0.5} />
              </mesh>
            </group>
          ))}

          {/* Heavy Loading Dock Shutter Roller Doors */}
          {/* North Wall Door */}
          <mesh position={[0, 0.9, -half - 0.03]} castShadow>
            <boxGeometry args={[1.8, 1.6, 0.04]} />
            <meshStandardMaterial color="#718096" roughness={0.6} metalness={0.7} />
          </mesh>
          {/* Shutter Door Trim */}
          <mesh position={[0, 1.72, -half - 0.02]} castShadow>
            <boxGeometry args={[2.0, 0.06, 0.06]} />
            <meshStandardMaterial color="#dd6b20" />
          </mesh>

          {/* Heavy metal Y-column structures for building support */}
          {[-half + 0.2, half - 0.2].map((x) =>
            [-half + 0.2, half - 0.2].map((z) => (
              <group key={`${x}-${z}`} position={[x, 0, z]}>
                <mesh castShadow>
                  <cylinderGeometry args={[0.04, 0.04, wallHeight, 8]} />
                  <meshStandardMaterial color="#4a5568" metalness={0.7} roughness={0.3} />
                </mesh>
                {/* diagonal support brackets */}
                <mesh position={[0, wallHeight - 0.15, 0]} rotation={[0, 0, Math.PI / 4]}>
                  <boxGeometry args={[0.03, 0.3, 0.03]} />
                  <meshStandardMaterial color="#4a5568" metalness={0.7} />
                </mesh>
              </group>
            ))
          )}
        </group>
      )}

      {/* Hospital specific cleanroom panels, medical monitors, exit signs */}
      {theme === 'hospital' && (
        <group>
          {/* Clean Turquoise baseboard plates */}
          {[-half - 0.035, half + 0.035].map((pos, idx) => (
            <group key={idx}>
              <mesh position={[0, 0.05, pos]}>
                <boxGeometry args={[size, 0.10, 0.015]} />
                <meshStandardMaterial color="#319795" roughness={0.2} />
              </mesh>
              <mesh position={[pos, 0.05, 0]} rotation={[0, Math.PI / 2, 0]}>
                <boxGeometry args={[size, 0.10, 0.015]} />
                <meshStandardMaterial color="#319795" roughness={0.2} />
              </mesh>
            </group>
          ))}

          {/* Medical ECG/Heart Rate Monitors on walls */}
          {/* North Wall Monitor */}
          <group position={[0, 1.3, -half - 0.03]}>
            <mesh castShadow>
              <boxGeometry args={[0.6, 0.4, 0.03]} />
              <meshStandardMaterial color="#2d3748" roughness={0.2} />
            </mesh>
            {/* Glowing Screen showing green sinus rhythm */}
            <mesh ref={ecgRef1} position={[0, 0, 0.016]}>
              <planeGeometry args={[0.54, 0.34]} />
              <meshBasicMaterial color="#00ffcc" />
            </mesh>
          </group>

          {/* West Wall Monitor */}
          <group position={[-half - 0.03, 1.3, 0]} rotation={[0, Math.PI / 2, 0]}>
            <mesh castShadow>
              <boxGeometry args={[0.6, 0.4, 0.03]} />
              <meshStandardMaterial color="#2d3748" roughness={0.2} />
            </mesh>
            {/* Glowing Screen showing blue sinus rhythm */}
            <mesh ref={ecgRef2} position={[0, 0, 0.016]}>
              <planeGeometry args={[0.54, 0.34]} />
              <meshBasicMaterial color="#00ffff" />
            </mesh>
          </group>

          {/* Glowing Green Emergency EXIT Signs */}
          {[-half + 1, half - 1].map((xVal, idx) => (
            <group key={idx} position={[xVal, wallHeight - 0.3, -half - 0.03]}>
              <mesh castShadow>
                <boxGeometry args={[0.26, 0.12, 0.03]} />
                <meshStandardMaterial color="#1a202c" />
              </mesh>
              {/* Glowing Green screen */}
              <mesh position={[0, 0, 0.016]}>
                <planeGeometry args={[0.22, 0.08]} />
                <meshBasicMaterial color="#38a169" />
              </mesh>
            </group>
          ))}

          {/* Sterile white wall columns */}
          {[-half + 0.1, half - 0.1].map((x) =>
            [-half + 0.1, half - 0.1].map((z) => (
              <mesh key={`${x}-${z}`} position={[x, wallHeight / 2, z]} castShadow>
                <boxGeometry args={[0.06, wallHeight, 0.06]} />
                <meshStandardMaterial color="#ffffff" roughness={0.1} />
              </mesh>
            ))
          )}
        </group>
      )}

      {/* Overhead Steel Roof Trusses & Structural Crossbeams (Ceiling girders) */}
      {[-half * 0.6, 0, half * 0.6].map((zPos, idx) => (
        <group key={idx} position={[0, wallHeight - 0.06, zPos]}>
          {/* Main Transverse Truss beam */}
          <mesh castShadow>
            <boxGeometry args={[size + 0.12, 0.06, 0.04]} />
            <meshStandardMaterial color={theme === 'warehouse' ? '#2d3748' : '#e2e8f0'} metalness={theme === 'warehouse' ? 0.8 : 0.3} roughness={0.2} />
          </mesh>
          {/* Connecting wall columns supporting the beams */}
          {[-half - 0.06, half + 0.06].map((xPos, pIdx) => (
            <mesh key={pIdx} position={[xPos, -wallHeight / 2, 0]} castShadow>
              <cylinderGeometry args={[0.02, 0.02, wallHeight, 8]} />
              <meshStandardMaterial color={theme === 'warehouse' ? '#a0aec0' : '#ffffff'} metalness={theme === 'warehouse' ? 0.7 : 0.2} roughness={0.3} />
            </mesh>
          ))}

          {/* Suspended Spotlights/Neon panels from the trusses */}
          {theme === 'warehouse' && (
            <group position={[0, -0.16, 0]}>
              {/* Halogen Spotlight Box */}
              <mesh castShadow>
                <boxGeometry args={[0.22, 0.14, 0.14]} />
                <meshStandardMaterial color="#1a202c" />
              </mesh>
              {/* Glowing Lens */}
              <mesh position={[0, -0.071, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.08, 0.08, 0.01, 8]} />
                <meshBasicMaterial color="#ffe082" />
              </mesh>
              {/* Actual SpotLight casting yellow down-glow */}
              <spotLight
                position={[0, -0.1, 0]}
                angle={Math.PI / 3}
                penumbra={0.6}
                intensity={1.5}
                distance={6}
                color="#ffe082"
                castShadow
              />
            </group>
          )}

          {theme === 'hospital' && (
            <group position={[0, -0.08, 0]}>
              {/* Cleanroom Neon light tube panel */}
              <mesh castShadow>
                <boxGeometry args={[0.62, 0.06, 0.12]} />
                <meshStandardMaterial color="#ffffff" roughness={0.1} />
              </mesh>
              {/* Glowing panel */}
              <mesh position={[0, -0.031, 0]}>
                <planeGeometry args={[0.58, 0.08]} rotation={[Math.PI / 2, 0, 0]} />
                <meshBasicMaterial color="#ffffff" />
              </mesh>
              <pointLight position={[0, -0.1, 0]} intensity={1.2} distance={5} color="#e0f7fa" />
            </group>
          )}
        </group>
      ))}
    </group>
  );
};

// Realistic Goal Target (Floating Golden Trophy or Cyber Cargo Box or Space Outpost Dome or Medical Dispenser)
const Goal3D = ({ position, theme = 'city' }) => {
  const trophyRef = useRef();
  const drillShaftRef = useRef();

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (trophyRef.current) {
      trophyRef.current.position.y = position[1] + 0.4 + Math.sin(t * 3) * 0.1;
      trophyRef.current.rotation.y = t * 1.5;
    }
    if (drillShaftRef.current) {
      drillShaftRef.current.rotation.y = t * 12.0; // Spin drill core super fast!
      drillShaftRef.current.position.y = -0.04 + Math.sin(t * 4.0) * 0.06; // plunge up and down!
    }
  });

  const laserColor = useMemo(() => {
    if (theme === 'warehouse') return '#ffdd00';
    if (theme === 'mars') return '#ff5500';
    if (theme === 'hospital') return '#00ffbb';
    return '#ffcc00';
  }, [theme]);

  if (theme === 'warehouse') {
    // High-tech Industrial Cyber Cargo Loader Bay (Ana Yükleme Rampası)
    return (
      <group position={position}>
        {/* Yellow-black concrete perimeter dock */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
          <ringGeometry args={[0.3, 0.38, 4]} />
          <meshBasicMaterial color="#dd6b20" />
        </mesh>
        
        {/* Main Dock Platform structure */}
        <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.6, 0.08, 0.6]} />
          <meshStandardMaterial color="#4a5568" roughness={0.7} />
        </mesh>

        {/* Floating Cargo Palette container */}
        <group ref={trophyRef}>
          {/* Pallet wood base */}
          <mesh position={[0, -0.16, 0]} castShadow>
            <boxGeometry args={[0.32, 0.03, 0.32]} />
            <meshStandardMaterial color="#8b5a2b" roughness={0.9} />
          </mesh>
          {/* Cyber Cargo Container carrying precious goods */}
          <mesh position={[0, -0.04, 0]} castShadow>
            <boxGeometry args={[0.26, 0.22, 0.26]} />
            <meshStandardMaterial color="#3182ce" metalness={0.7} roughness={0.2} />
          </mesh>
          {/* Glowing delivery barcode logo panel */}
          <mesh position={[0, -0.04, 0.134]}>
            <planeGeometry args={[0.16, 0.10]} />
            <meshBasicMaterial color="#38bdf8" />
          </mesh>
        </group>

        {/* Tall loading laser indicator */}
        <mesh position={[0, 15, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 30, 8, 1, true]} />
          <meshBasicMaterial
            color={laserColor}
            transparent
            opacity={0.35}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>
    );
  }

  if (theme === 'mars') {
    // 🚀 Epic Planetary Core Drilling Rig & Resource Excavator
    return (
      <group position={position}>
        {/* Holographic scanner ring (highly transparent warm-amber) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[0.32, 0.40, 32]} />
          <meshBasicMaterial color="#ff5500" transparent opacity={0.15} blending={THREE.AdditiveBlending} />
        </mesh>

        {/* Heavy Rig Harvester Assembly */}
        <group position={[0, 0, 0]}>
          {/* Pad foundation */}
          <mesh position={[0, 0.02, 0]} castShadow>
            <boxGeometry args={[0.62, 0.04, 0.62]} />
            <meshStandardMaterial color="#2d3748" metalness={0.8} />
          </mesh>
          {/* Dual Solar wing brackets */}
          {[-0.26, 0.26].map((xVal, idx) => (
            <mesh key={idx} position={[xVal, 0.14, 0]} rotation={[0.4, 0, idx === 0 ? 0.4 : -0.4]} castShadow>
              <boxGeometry args={[0.16, 0.008, 0.38]} />
              <meshStandardMaterial color="#1a365d" metalness={0.9} roughness={0.05} />
            </mesh>
          ))}
          {/* Central drill rig support tower towers */}
          {[-0.08, 0.08].map((xVal, idx) => (
            <mesh key={idx} position={[xVal, 0.22, 0]} castShadow>
              <boxGeometry args={[0.02, 0.40, 0.04]} />
              <meshStandardMaterial color="#4a5568" metalness={0.7} />
            </mesh>
          ))}
          {/* Top telemetry beam projector housing */}
          <mesh position={[0, 0.42, 0]} castShadow>
            <boxGeometry args={[0.22, 0.06, 0.08]} />
            <meshStandardMaterial color="#1a202c" metalness={0.9} />
          </mesh>

          {/* Rotating matkap drill shaft plunging down! */}
          <mesh ref={drillShaftRef} position={[0, 0.12, 0]} castShadow>
            <cylinderGeometry args={[0.018, 0.018, 0.36, 6]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.95} roughness={0.1} />
          </mesh>
        </group>

        {/* Soft telemetry orange plasma laser beam shooting straight to the mothership */}
        <mesh position={[0, 15, 0]}>
          <cylinderGeometry args={[0.038, 0.038, 30, 8, 1, true]} />
          <meshBasicMaterial
            color={laserColor}
            transparent
            opacity={0.1}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>
    );
  }

  if (theme === 'hospital') {
    // Central Emergency Pharmacy Dispensation Hub
    return (
      <group position={position}>
        {/* Glowing cross guide on floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[0.3, 0.36, 4]} />
          <meshBasicMaterial color="#00ffcc" transparent opacity={0.65} />
        </mesh>

        {/* Floating clinical dispatcher pod */}
        <group ref={trophyRef}>
          {/* Dispatcher base */}
          <mesh position={[0, -0.10, 0]} castShadow>
            <cylinderGeometry args={[0.2, 0.2, 0.08, 16]} />
            <meshStandardMaterial color="#ffffff" roughness={0.1} />
          </mesh>
          {/* Glass dome chamber */}
          <mesh position={[0, 0.04, 0]} castShadow>
            <sphereGeometry args={[0.16, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#4fd1c5" opacity={0.4} transparent roughness={0.05} metalness={0.9} />
          </mesh>
          {/* Floating red cross symbol inside glass case */}
          <mesh position={[0, 0.04, 0]}>
            <boxGeometry args={[0.04, 0.16, 0.04]} />
            <meshBasicMaterial color="#ff3b30" />
          </mesh>
          <mesh position={[0, 0.04, 0]} rotation={[0, Math.PI / 2, 0]}>
            <boxGeometry args={[0.04, 0.16, 0.04]} />
            <meshBasicMaterial color="#ff3b30" />
          </mesh>
        </group>

        {/* Golden-cyan laser beacon */}
        <mesh position={[0, 15, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 30, 8, 1, true]} />
          <meshBasicMaterial
            color={laserColor}
            transparent
            opacity={0.35}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>
    );
  }

  // Original City Goal (Trophy Cup)
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.3, 0.35, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
      </mesh>
      <group ref={trophyRef}>
        <mesh position={[0, 0, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.12, 0.08, 12]} />
          <meshStandardMaterial color="#1a202c" roughness={0.5} metalness={0.8} />
        </mesh>
        <mesh position={[0, 0.1, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 0.14, 8]} />
          <meshStandardMaterial color="#ecc94b" roughness={0.1} metalness={0.9} />
        </mesh>
        <mesh position={[0, 0.24, 0]} castShadow>
          <cylinderGeometry args={[0.14, 0.06, 0.18, 12]} />
          <meshStandardMaterial color="#ecc94b" roughness={0.1} metalness={0.9} />
        </mesh>
        {[-0.11, 0.11].map((x, idx) => (
          <mesh key={idx} position={[x, 0.26, 0]} rotation={[0, 0, idx === 0 ? 0.3 : -0.3]} castShadow>
            <torusGeometry args={[0.06, 0.012, 6, 16, Math.PI]} />
            <meshStandardMaterial color="#ecc94b" roughness={0.1} metalness={0.9} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, 15, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 30, 8, 1, true]} />
        <meshBasicMaterial
          color={laserColor}
          transparent
          opacity={0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

// Realistic Episode Starting Point Marker
const StartPoint3D = ({ position, theme = 'city' }) => {
  const beaconColor = useMemo(() => {
    if (theme === 'warehouse') return '#ffd800'; // warning yellow
    if (theme === 'mars') return '#ff6600'; // mars cyber orange
    if (theme === 'hospital') return '#00ffcc'; // sanitary cyan
    return '#00ffff'; // city electric blue
  }, [theme]);

  const padColor = useMemo(() => {
    if (theme === 'warehouse') return '#b7791f';
    if (theme === 'mars') return '#c05621';
    if (theme === 'hospital') return '#319795';
    return '#0080ff';
  }, [theme]);

  if (theme === 'hospital') {
    // 🏥 Sanitization Air Shower Portal (Dezenfeksiyon Geçidi)
    return (
      <group position={position}>
        {/* Flat glowing circle on the ground */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[0.3, 0.35, 32]} />
          <meshBasicMaterial color="#00ffcc" transparent opacity={0.8} />
        </mesh>
        
        {/* Volumetric Decontamination Archway Structure */}
        <group position={[0, 0, 0]}>
          {/* Left chrome support post */}
          <mesh position={[-0.32, 0.32, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.025, 0.64, 8]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.8} roughness={0.1} />
          </mesh>
          {/* Right chrome support post */}
          <mesh position={[0.32, 0.32, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.025, 0.64, 8]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.8} roughness={0.1} />
          </mesh>
          {/* Top curved arch lintel */}
          <mesh position={[0, 0.64, 0]} castShadow>
            <boxGeometry args={[0.68, 0.04, 0.06]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.8} roughness={0.1} />
          </mesh>
          {/* Glowing circular guide scanning ring under the arch lintel */}
          <mesh position={[0, 0.60, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.18, 0.22, 16]} />
            <meshBasicMaterial color="#00ffcc" transparent opacity={0.8} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
        
        {/* Tall scanning sanitary laser beam */}
        <mesh position={[0, 15, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 30, 8, 1, true]} />
          <meshBasicMaterial
            color="#00ffcc"
            transparent
            opacity={0.3}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>
    );
  }

  return (
    <group position={position}>
      {/* Flat glowing circle on the ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.3, 0.35, 32]} />
        <meshBasicMaterial color={beaconColor} transparent opacity={theme === 'mars' ? 0.22 : 0.8} />
      </mesh>
      
      {/* Start pad tile */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <circleGeometry args={[0.28, 32]} />
        <meshBasicMaterial color={padColor} transparent opacity={theme === 'mars' ? 0.12 : 0.3} />
      </mesh>
      
      {/* Tall glowing vertical electric cyan laser beam going straight to the sky! */}
      <mesh position={[0, 15, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 30, 8, 1, true]} />
        <meshBasicMaterial
          color={beaconColor}
          transparent
          opacity={theme === 'mars' ? 0.06 : 0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

// Realistic Waypoint (Floating Checkpoint platform)
const Waypoint3D = ({ position, theme = 'city' }) => {
  const markerRef = useRef();

  useFrame(({ clock }) => {
    if (markerRef.current) {
      markerRef.current.position.y = 0.72 + Math.sin(clock.getElapsedTime() * 3.5) * 0.04;
      markerRef.current.rotation.y = clock.getElapsedTime() * 1.5;
    }
  });

  const laserColor = useMemo(() => {
    if (theme === 'warehouse') return '#ffd800'; // yellow laser
    if (theme === 'mars') return '#ff6600'; // orange laser
    if (theme === 'hospital') return '#00ffcc'; // turquoise laser
    return '#00ff66'; // city green laser
  }, [theme]);

  const hologramColor = useMemo(() => {
    if (theme === 'warehouse') return '#e0a96d';
    if (theme === 'mars') return '#ff9f1c';
    if (theme === 'hospital') return '#06d6a0';
    return '#4fd1c5';
  }, [theme]);

  if (theme === 'warehouse') {
    // Smart Warehouse Sorting / Cargo Drop Zone (Palet Teslim Noktası)
    return (
      <group position={position}>
        {/* Concrete bay pad with yellow hazard borders */}
        <mesh position={[0, 0.015, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.66, 0.02, 0.66]} />
          <meshStandardMaterial color="#2d3748" roughness={0.7} />
        </mesh>
        
        {/* Yellow striped hazard border ring */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.026, 0]}>
          <ringGeometry args={[0.26, 0.31, 4]} />
          <meshBasicMaterial color="#ecc94b" />
        </mesh>

        {/* Cargo roller conveyer tracks */}
        {[-0.18, 0.0, 0.18].map((z, idx) => (
          <mesh key={idx} position={[0, 0.042, z]} rotation={[0, Math.PI / 2, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 0.44, 8]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.9} roughness={0.1} />
          </mesh>
        ))}

        {/* Glowing holographic item icon */}
        <group ref={markerRef} position={[0, 0.54, 0]}>
          <mesh>
            <boxGeometry args={[0.08, 0.08, 0.08]} />
            <meshBasicMaterial color={hologramColor} transparent opacity={0.65} />
          </mesh>
        </group>

        {/* Teleportation/Delivery Laser portal guide */}
        <mesh position={[0, 15, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 30, 8, 1, true]} />
          <meshBasicMaterial
            color={laserColor}
            transparent
            opacity={0.25}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>
    );
  }

  if (theme === 'mars') {
    // Extraterrestrial Drill Core Soil-Sampling Bay
    return (
      <group position={position}>
        {/* Metallic base ring (highly transparent warm-amber) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[0.28, 0.33, 16]} />
          <meshBasicMaterial color="#ff6600" transparent opacity={0.22} />
        </mesh>

        {/* Telemetry solar battery cell */}
        <mesh position={[0, 0.08, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.16, 0.14, 8]} />
          <meshStandardMaterial color="#1a202c" metalness={0.8} roughness={0.2} />
        </mesh>

        {/* Soil extraction drill shaft (Hologram style drill tip, very subtle telemetry outline) */}
        <group ref={markerRef} position={[0, 0.44, 0]}>
          <mesh>
            <coneGeometry args={[0.07, 0.16, 8]} />
            <meshBasicMaterial color={hologramColor} transparent opacity={0.25} />
          </mesh>
        </group>

        {/* Telemetry connection laser beam (highly transparent fine laser) */}
        <mesh position={[0, 15, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 30, 8, 1, true]} />
          <meshBasicMaterial
            color={laserColor}
            transparent
            opacity={0.05}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>
    );
  }

  if (theme === 'hospital') {
    // Patient Emergency Ward Bed / Medical Dispense Spot
    return (
      <group position={position}>
        {/* Sanitary guide circle */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[0.28, 0.33, 32]} />
          <meshBasicMaterial color="#00ffcc" opacity={0.6} transparent />
        </mesh>

        {/* Clean white medical trolley table */}
        <mesh position={[0, 0.12, 0]} castShadow>
          <boxGeometry args={[0.34, 0.20, 0.50]} />
          <meshStandardMaterial color="#ffffff" roughness={0.2} />
        </mesh>

        {/* Interactive touchscreen panel */}
        <mesh position={[0, 0.24, -0.16]} rotation={[-0.4, 0, 0]} castShadow>
          <boxGeometry args={[0.20, 0.02, 0.14]} />
          <meshStandardMaterial color="#4a5568" />
        </mesh>

        {/* Glowing health capsule hologram floating */}
        <group ref={markerRef} position={[0, 0.54, 0]}>
          <mesh>
            <sphereGeometry args={[0.07, 8, 8]} />
            <meshBasicMaterial color={hologramColor} transparent opacity={0.75} />
          </mesh>
        </group>

        {/* Cyan medical beam portal */}
        <mesh position={[0, 15, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 30, 8, 1, true]} />
          <meshBasicMaterial
            color={laserColor}
            transparent
            opacity={0.25}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>
    );
  }

  // Original City Waypoint (City Bus Stop)
  return (
    <group position={position}>
      {/* 1. Stop Platform concrete pad */}
      <mesh position={[0, 0.01, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.55, 0.02, 0.75]} />
        <meshStandardMaterial color="#4a5568" roughness={0.8} />
      </mesh>

      {/* 2. Concrete/Metallic pillars */}
      {[-0.24, 0.24].map((z, idx) => (
        <mesh key={idx} position={[-0.20, 0.22, z]} castShadow>
          <cylinderGeometry args={[0.016, 0.016, 0.44, 8]} />
          <meshStandardMaterial color="#cbd5e0" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}

      {/* 3. Sleek Translucent Glass back wall pane */}
      <mesh position={[-0.20, 0.22, 0]} castShadow>
        <boxGeometry args={[0.01, 0.38, 0.46]} />
        <meshStandardMaterial color="#4fd1c5" opacity={0.35} transparent roughness={0.05} metalness={0.9} />
      </mesh>

      {/* 4. Bench for waiting passengers */}
      <mesh position={[-0.06, 0.10, 0]} castShadow>
        <boxGeometry args={[0.14, 0.02, 0.38]} />
        <meshStandardMaterial color="#ecc94b" roughness={0.5} />
      </mesh>
      {[-0.14, 0.14].map((z, idx) => (
        <mesh key={idx} position={[-0.06, 0.05, z]} castShadow>
          <boxGeometry args={[0.12, 0.10, 0.02]} />
          <meshStandardMaterial color="#1a202c" />
        </mesh>
      ))}

      {/* 5. Futuristic curved shelter roof */}
      <mesh position={[-0.05, 0.44, 0]} castShadow>
        <boxGeometry args={[0.42, 0.02, 0.70]} />
        <meshStandardMaterial color="#2d3748" metalness={0.6} roughness={0.3} />
      </mesh>

      {/* 6. Glowing LED Route Sign Board */}
      <mesh position={[0.20, 0.24, 0.28]} castShadow>
        <boxGeometry args={[0.04, 0.36, 0.12]} />
        <meshStandardMaterial color="#2d3748" />
      </mesh>
      <mesh position={[0.178, 0.24, 0.28]}>
        <planeGeometry args={[0.10, 0.32]} />
        <meshStandardMaterial color="#ecc94b" emissive="#ecc94b" emissiveIntensity={0.8} />
      </mesh>

      {/* 7. Floating Glowing holographic indicator sign on top */}
      <group ref={markerRef} position={[0, 0.72, 0]}>
        {/* Floating Ring */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.08, 0.10, 16]} />
          <meshBasicMaterial color="#4fd1c5" transparent opacity={0.6} />
        </mesh>
        {/* Central Stop Icon */}
        <mesh>
          <boxGeometry args={[0.02, 0.08, 0.06]} />
          <meshBasicMaterial color="#319795" />
        </mesh>
      </group>

      {/* Tall glowing emerald green laser beam cutting straight into the clouds! */}
      <mesh position={[0, 15, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 30, 8, 1, true]} />
        <meshBasicMaterial
          color={laserColor}
          transparent
          opacity={0.25}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

// Realistic Smart Traffic Light or Industrial Safety Beacon or Planetary Transmitter Spire or Hospital sanitary wing arch
const TrafficLight3D = ({ position, isGreen, theme = 'city' }) => {
  if (theme === 'warehouse') {
    // Smart Industrial Warning Beacon Tower (Sinyal Direği)
    return (
      <group position={position}>
        {/* Concrete post foundation */}
        <mesh position={[0, 0.04, 0]} castShadow>
          <cylinderGeometry args={[0.06, 0.07, 0.08, 8]} />
          <meshStandardMaterial color="#4a5568" roughness={0.8} />
        </mesh>
        {/* Yellow-black striped warning metal pole */}
        <mesh position={[0, 0.55, 0]} castShadow>
          <cylinderGeometry args={[0.016, 0.018, 1.0, 8]} />
          <meshStandardMaterial color="#cbd5e0" metalness={0.7} roughness={0.3} />
        </mesh>
        {/* Sleek metallic warning head housing */}
        <mesh position={[0, 1.05, 0]} castShadow>
          <boxGeometry args={[0.08, 0.22, 0.08]} />
          <meshStandardMaterial color="#2d3748" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Red Alarm Strobelight (Top) */}
        <mesh position={[0, 1.11, 0.052]}>
          <sphereGeometry args={[0.038, 8, 8]} />
          <meshBasicMaterial color={!isGreen ? "#ff0000" : "#2d3748"} />
        </mesh>
        {/* Green Safe Indicator Strobelight (Bottom) */}
        <mesh position={[0, 0.99, 0.052]}>
          <sphereGeometry args={[0.038, 8, 8]} />
          <meshBasicMaterial color={isGreen ? "#00ff00" : "#2d3748"} />
        </mesh>
      </group>
    );
  }

  if (theme === 'mars') {
    // Solar-powered planetary telemetry navigational beacon spire
    return (
      <group position={position}>
        {/* Rugged mounting base */}
        <mesh position={[0, 0.04, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.10, 0.08, 6]} />
          <meshStandardMaterial color="#4a5568" roughness={0.9} />
        </mesh>
        {/* Slender telemetry pole */}
        <mesh position={[0, 0.60, 0]} castShadow>
          <cylinderGeometry args={[0.012, 0.015, 1.12, 6]} />
          <meshStandardMaterial color="#cbd5e0" metalness={0.9} />
        </mesh>
        {/* Transmitting emitter dome */}
        <mesh position={[0, 1.15, 0]}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color="#1a202c" />
        </mesh>
        {/* Glowing Telemetry Active beacon light */}
        <mesh position={[0, 1.15, 0]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshBasicMaterial color={isGreen ? "#00ffff" : "#ff5500"} />
        </mesh>
      </group>
    );
  }

  if (theme === 'hospital') {
    // Sanitary Corridor Sliding Door Entry Sign / Warning Beacon
    return (
      <group position={position}>
        {/* Minimal clean mounting base */}
        <mesh position={[0, 0.04, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.06, 0.08, 12]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.2} />
        </mesh>
        {/* White medical pole */}
        <mesh position={[0, 0.55, 0]} castShadow>
          <cylinderGeometry args={[0.015, 0.015, 1.0, 12]} />
          <meshStandardMaterial color="#ffffff" roughness={0.1} />
        </mesh>
        {/* Sign panel */}
        <mesh position={[0, 1.05, 0]} castShadow>
          <boxGeometry args={[0.06, 0.20, 0.14]} />
          <meshStandardMaterial color="#ffffff" roughness={0.1} />
        </mesh>
        {/* Danger Red sanitary restriction circle */}
        <mesh position={[0.032, 1.10, 0]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshBasicMaterial color={!isGreen ? "#ff3b30" : "#2d3748"} />
        </mesh>
        {/* Clean Green entry clearance circle */}
        <mesh position={[0.032, 1.00, 0]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshBasicMaterial color={isGreen ? "#4fd1c5" : "#2d3748"} />
        </mesh>
      </group>
    );
  }

  // Original City Street Traffic Light
  return (
    <group position={position}>
      {/* Concrete base pad */}
      <mesh position={[0, 0.04, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.08, 0.08, 12]} />
        <meshStandardMaterial color="#718096" roughness={0.8} />
      </mesh>

      {/* Realistic metal pole */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.02, 1.0, 12]} />
        <meshStandardMaterial color="#2d3748" metalness={0.5} roughness={0.4} />
      </mesh>

      {/* Horizontal extension arm */}
      <mesh position={[0, 1.05, 0.1]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, 0.22, 8]} />
        <meshStandardMaterial color="#2d3748" metalness={0.5} roughness={0.4} />
      </mesh>

      {/* Signal housing box */}
      <mesh position={[0, 1.05, 0.22]} castShadow>
        <boxGeometry args={[0.1, 0.24, 0.1]} />
        <meshStandardMaterial color="#1a202c" metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Sun shades/visors for lamps */}
      {[-0.07, 0.0, 0.07].map((yOffset, idx) => (
        <mesh key={idx} position={[0, 1.05 + yOffset, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.02, 12, 1, true]} />
          <meshStandardMaterial color="#1a202c" side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* Red Light (Top) - High Saturated Pure Red */}
      <mesh position={[0, 1.12, 0.26]}>
        <sphereGeometry args={[0.046, 8, 8]} />
        <meshBasicMaterial color={!isGreen ? "#ff0000" : "#2d3748"} />
      </mesh>

      {/* Amber Light (Middle - Solid off) */}
      <mesh position={[0, 1.05, 0.26]}>
        <sphereGeometry args={[0.046, 8, 8]} />
        <meshBasicMaterial color="#2d3748" />
      </mesh>

      {/* Green Light (Bottom) - High Saturated Pure Green */}
      <mesh position={[0, 0.98, 0.26]}>
        <sphereGeometry args={[0.046, 8, 8]} />
        <meshBasicMaterial color={isGreen ? "#00ff00" : "#2d3748"} />
      </mesh>
    </group>
  );
};

// Realistic Agent (Self-driving Ferrari or procedural AMR cargo carrier or Martian space rover or medical dispenser capsule)
const Agent3D = ({ position, lastAction, smoothCarPosRef, simSpeed = 450, theme = 'city', carColor = '#00ffff', racerLabel = 'AI AGENT' }) => {
  const agentRef = useRef();
  
  const { scene } = useGLTF('https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/models/gltf/ferrari.glb');
  
  const positionRef = useRef(position);
  positionRef.current = position;

  const targetAngleRef = useRef(0);
  const currentAngleRef = useRef(0);
  const currentPosRef = useRef(new THREE.Vector3());
  
  const pitchRef = useRef(0);
  const rollRef = useRef(0);

  const wheelsRef = useRef([]);

  const modelScene = useMemo(() => {
    if (theme !== 'city') return null; // Only use for city theme
    const clone = scene.clone();
    wheelsRef.current = [];
    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.name.toLowerCase().includes('wheel')) {
          wheelsRef.current.push(child);
        }
        
        // Ferrari body paint ve metal parçalarını özel araç rengimiz ile boya
        if (child.name.toLowerCase().includes('body') || child.name.toLowerCase().includes('paint')) {
          if (child.material) {
            child.material = child.material.clone();
            child.material.color.set(carColor);
          }
        }
      }
    });
    return clone;
  }, [scene, theme, carColor]);

  if (lastAction) {
    switch (lastAction.action_label) {
      case 'UP': targetAngleRef.current = 0; break;
      case 'DOWN': targetAngleRef.current = Math.PI; break;
      case 'LEFT': targetAngleRef.current = Math.PI / 2; break;
      case 'RIGHT': targetAngleRef.current = -Math.PI / 2; break;
    }
  }

  // Ref for spinning LIDAR/Radar domes on procedural robots
  const sensorSpinRef = useRef();

  useFrame((state, delta) => {
    let diff = targetAngleRef.current - currentAngleRef.current;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    currentAngleRef.current += diff * Math.min(delta * 12.0, 1.0);
    
    const tx = positionRef.current[0];
    const ty = positionRef.current[1];
    const tz = positionRef.current[2];
    
    const lerpSpeed = Math.max(1.6, Math.min(10.0, 1500 / simSpeed));
    
    currentPosRef.current.x += (tx - currentPosRef.current.x) * Math.min(delta * lerpSpeed, 1.0);
    currentPosRef.current.y += (ty - currentPosRef.current.y) * Math.min(delta * lerpSpeed, 1.0);
    currentPosRef.current.z += (tz - currentPosRef.current.z) * Math.min(delta * lerpSpeed, 1.0);
    
    if (smoothCarPosRef) {
      smoothCarPosRef.current.copy(currentPosRef.current);
    }
    
    const rotAmount = 4.5 * delta * 5.0;
    if (theme === 'city') {
      wheelsRef.current.forEach((wheel) => {
        wheel.rotation.x += rotAmount;
      });
    }

    if (sensorSpinRef.current) {
      sensorSpinRef.current.rotation.y += delta * 6.0; // Spin radar/LIDAR fast!
    }

    let targetRoll = 0;
    if (lastAction) {
      if (lastAction.action_label === 'LEFT') targetRoll = 0.04;
      if (lastAction.action_label === 'RIGHT') targetRoll = -0.04;
    }
    rollRef.current += (targetRoll - rollRef.current) * Math.min(delta * 8.0, 1.0);
    pitchRef.current += (0.0 - pitchRef.current) * Math.min(delta * 8.0, 1.0);

    if (agentRef.current) {
      agentRef.current.rotation.y = currentAngleRef.current;
      agentRef.current.position.copy(currentPosRef.current);
    }
  });

  const neonColor = useMemo(() => {
    return carColor;
  }, [carColor]);

  return (
    <group ref={agentRef}>
      {/* 3D Floating Name Label */}
      <Html distanceFactor={4} position={[0, 0.65, 0]} center>
        <div style={{
          background: 'rgba(15, 23, 42, 0.9)',
          border: `1px solid ${carColor}`,
          boxShadow: `0 0 10px ${carColor}`,
          color: '#ffffff',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '9px',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          textShadow: '0 0 4px #000'
        }}>
          {racerLabel}
        </div>
      </Html>

      {/* Dynamic neon underglow plane staying flat on concrete */}
      {theme !== 'mars' && (
        <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.55, 0.78]} />
          <meshBasicMaterial color={neonColor} transparent opacity={0.35} />
        </mesh>
      )}
      
      {/* Volumetric Underglow Halo */}
      {theme !== 'mars' && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.62, 0.88]} />
          <meshBasicMaterial color={neonColor} transparent opacity={0.14} blending={THREE.AdditiveBlending} />
        </mesh>
      )}

      {/* Tilting suspension chassis group */}
      <group rotation={[pitchRef.current, 0, rollRef.current]}>
        {theme === 'city' && modelScene && (
          /* Render City Supercar */
          <>
            <primitive object={modelScene} scale={0.32} rotation={[0, 0, 0]} position={[0, -0.015, 0]} />
            <pointLight position={[0, 0.12, -0.45]} intensity={1.8} distance={4.0} color="#fffaed" />
            {[-0.18, 0.18].map((x, idx) => (
              <mesh key={`head-${idx}`} position={[x, 0.10, -0.45]}>
                <sphereGeometry args={[0.03, 8, 8]} />
                <meshBasicMaterial color="#ffffff" transparent opacity={0.8} />
              </mesh>
            ))}
            {[-0.18, 0.18].map((x, idx) => (
              <mesh key={`tail-${idx}`} position={[x, 0.12, 0.45]}>
                <sphereGeometry args={[0.025, 8, 8]} />
                <meshBasicMaterial color="#ff3b30" />
              </mesh>
            ))}
          </>
        )}

        {theme === 'warehouse' && (
          /* Render Advanced Humanoid Logistics Robot (Digit/Atlas style carrying a box) */
          <group position={[0, 0.04, 0]}>
            {/* 1. Heavy Rolling Drive Base (Paletler/Tekerlekler) */}
            <mesh position={[0, 0.02, 0]} castShadow>
              <boxGeometry args={[0.38, 0.06, 0.38]} />
              <meshStandardMaterial color="#1a202c" roughness={0.8} metalness={0.6} />
            </mesh>
            {/* Left and Right crawler tracks */}
            {[-0.20, 0.20].map((xVal, idx) => (
              <group key={idx} position={[xVal, 0.02, 0]}>
                <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                  <cylinderGeometry args={[0.044, 0.044, 0.04, 10]} />
                  <meshStandardMaterial color="#2d3748" roughness={0.9} />
                </mesh>
                {/* Wheels inside tracks */}
                {[-0.12, 0.12].map((zVal, wIdx) => (
                  <mesh key={wIdx} position={[0, 0, zVal]} rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.044, 0.044, 0.01, 8]} />
                    <meshStandardMaterial color="#cbd5e0" metalness={0.9} />
                  </mesh>
                ))}
              </group>
            ))}

            {/* 2. Cybernetic Swiveling Upper Torso */}
            <group position={[0, 0.08, 0]}>
              {/* Torso support column */}
              <mesh position={[0, 0.06, 0]} castShadow>
                <cylinderGeometry args={[0.03, 0.04, 0.14, 8]} />
                <meshStandardMaterial color="#718096" metalness={0.8} />
              </mesh>
              {/* Upper chest shell (Industrial Safety Orange) */}
              <mesh position={[0, 0.22, 0]} castShadow>
                <boxGeometry args={[0.32, 0.20, 0.24]} />
                <meshStandardMaterial color="#ff7a00" roughness={0.3} metalness={0.6} /> {/* Safety Orange */}
              </mesh>
              {/* Warning stripes plate on chest */}
              <mesh position={[0, 0.22, -0.122]}>
                <planeGeometry args={[0.22, 0.10]} />
                <meshBasicMaterial color="#ecc94b" />
              </mesh>

              {/* 3. Swivel Robot Head with Glowing Visor */}
              <group position={[0, 0.36, 0]}>
                {/* neck joint */}
                <mesh castShadow>
                  <cylinderGeometry args={[0.025, 0.025, 0.06, 8]} />
                  <meshStandardMaterial color="#cbd5e0" metalness={0.8} />
                </mesh>
                {/* helmet head */}
                <mesh position={[0, 0.08, 0]} castShadow>
                  <sphereGeometry args={[0.09, 12, 12]} />
                  <meshStandardMaterial color="#ffffff" roughness={0.1} metalness={0.3} />
                </mesh>
                {/* Glowing neon visor screen */}
                <mesh position={[0, 0.09, -0.076]} rotation={[0.1, 0, 0]}>
                  <boxGeometry args={[0.12, 0.025, 0.03]} />
                  <meshBasicMaterial color="#38bdf8" />
                </mesh>
              </group>

              {/* 4. Robotic Arms Carrying Cardboard Shipping Box */}
              {/* Left Arm */}
              <group position={[-0.18, 0.24, -0.04]} rotation={[0.6, 0.1, -0.2]}>
                {/* Shoulder and upper arm */}
                <mesh castShadow>
                  <boxGeometry args={[0.04, 0.16, 0.04]} />
                  <meshStandardMaterial color="#4a5568" metalness={0.7} />
                </mesh>
                {/* Elbow joint */}
                <mesh position={[0, -0.08, 0]}>
                  <sphereGeometry args={[0.026]} />
                  <meshStandardMaterial color="#cbd5e0" />
                </mesh>
                {/* Forearm extending forward */}
                <mesh position={[0, -0.08, -0.10]} rotation={[-1.1, 0, 0]} castShadow>
                  <boxGeometry args={[0.035, 0.18, 0.035]} />
                  <meshStandardMaterial color="#4a5568" metalness={0.7} />
                </mesh>
              </group>
              
              {/* Right Arm */}
              <group position={[0.18, 0.24, -0.04]} rotation={[0.6, -0.1, 0.2]}>
                {/* Shoulder and upper arm */}
                <mesh castShadow>
                  <boxGeometry args={[0.04, 0.16, 0.04]} />
                  <meshStandardMaterial color="#4a5568" metalness={0.7} />
                </mesh>
                {/* Elbow joint */}
                <mesh position={[0, -0.08, 0]}>
                  <sphereGeometry args={[0.026]} />
                  <meshStandardMaterial color="#cbd5e0" />
                </mesh>
                {/* Forearm extending forward */}
                <mesh position={[0, -0.08, -0.10]} rotation={[-1.1, 0, 0]} castShadow>
                  <boxGeometry args={[0.035, 0.18, 0.035]} />
                  <meshStandardMaterial color="#4a5568" metalness={0.7} />
                </mesh>
              </group>

              {/* 5. The Brown Cardboard Shipping Box held in arms */}
              <group position={[0, 0.16, -0.26]} rotation={[0, 0, 0]}>
                <mesh castShadow>
                  <boxGeometry args={[0.26, 0.22, 0.22]} />
                  <meshStandardMaterial color="#c6905d" roughness={0.8} /> {/* Cardboard Kraft color */}
                </mesh>
                {/* Box tape overlay */}
                <mesh position={[0, 0.112, 0]}>
                  <planeGeometry args={[0.03, 0.22]} rotation={[Math.PI / 2, 0, 0]} />
                  <meshBasicMaterial color="#a16b3d" />
                </mesh>
                {/* Fragile Glass icon or Barcode on the side */}
                <mesh position={[0, 0, -0.112]}>
                  <planeGeometry args={[0.12, 0.08]} />
                  <meshBasicMaterial color="#ffffff" />
                </mesh>
                <mesh position={[0, 0, -0.114]}>
                  <planeGeometry args={[0.10, 0.06]} />
                  <meshBasicMaterial color="#1a202c" />
                </mesh>
              </group>
            </group>

            {/* Fast Spinning active LIDAR sensor dome mounted on robot's back shoulder */}
            <group ref={sensorSpinRef} position={[0.10, 0.36, 0.10]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.015, 0.015, 0.06, 8]} />
                <meshStandardMaterial color="#4a5568" />
              </mesh>
              <mesh position={[0, 0.04, 0]} castShadow>
                <cylinderGeometry args={[0.036, 0.036, 0.025, 8]} />
                <meshStandardMaterial color="#1a202c" roughness={0.2} />
              </mesh>
              <mesh position={[0, 0.04, -0.038]}>
                <sphereGeometry args={[0.007, 4, 4]} />
                <meshBasicMaterial color="#00ffcc" />
              </mesh>
            </group>

            {/* Rear blinking safety beacon pole */}
            <mesh position={[-0.12, 0.36, 0.12]} castShadow>
              <cylinderGeometry args={[0.005, 0.005, 0.16, 6]} />
              <meshStandardMaterial color="#4a5568" />
            </mesh>
            <mesh position={[-0.12, 0.44, 0.12]}>
              <sphereGeometry args={[0.014, 6, 6]} />
              <meshBasicMaterial color="#ecc94b" />
            </mesh>
          </group>
        )}

        {theme === 'mars' && (
          /* Render Curiosity-style Space Exploration Mars Rover */
          <group position={[0, 0.08, 0]}>
            {/* Hexagonal cyber body */}
            <mesh castShadow>
              <cylinderGeometry args={[0.22, 0.26, 0.10, 6]} />
              <meshStandardMaterial color="#a0aec0" roughness={0.3} metalness={0.8} />
            </mesh>

            {/* Blue solar panel wing sheets on back */}
            <mesh position={[0, 0.06, 0.12]} rotation={[0.1, 0, 0]} castShadow>
              <boxGeometry args={[0.38, 0.01, 0.22]} />
              <meshStandardMaterial color="#1a365d" metalness={0.9} roughness={0.05} />
            </mesh>

            {/* 6 Mars rocker-bogie rugged wheels */}
            {[-0.26, 0.26].map((x) =>
              [-0.22, 0, 0.22].map((z, idx) => (
                <mesh key={`${x}-${z}-${idx}`} position={[x, -0.04, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
                  <cylinderGeometry args={[0.05, 0.05, 0.04, 8]} />
                  <meshStandardMaterial color="#2d3748" roughness={0.9} />
                </mesh>
              ))
            )}

            {/* Camera Mast Tower pointing forward */}
            <mesh position={[0, 0.18, -0.12]} castShadow>
              <cylinderGeometry args={[0.01, 0.01, 0.26, 6]} />
              <meshStandardMaterial color="#718096" metalness={0.9} />
            </mesh>
            {/* Camera Head with lens */}
            <group ref={sensorSpinRef} position={[0, 0.31, -0.12]}>
              <mesh castShadow>
                <boxGeometry args={[0.08, 0.06, 0.06]} />
                <meshStandardMaterial color="#2d3748" metalness={0.6} />
              </mesh>
              <mesh position={[0, 0, -0.032]}>
                <sphereGeometry args={[0.014, 8, 8]} />
                <meshStandardMaterial color="#d69e2e" metalness={0.9} roughness={0.1} />
              </mesh>
            </group>

            {/* Spinning radar communication tracker dish */}
            <group ref={sensorSpinRef} position={[-0.10, 0.09, 0.06]} rotation={[0, 0, 0.2]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.006, 0.006, 0.08, 6]} />
                <meshStandardMaterial color="#cbd5e0" />
              </mesh>
              {/* Dish bowl */}
              <mesh position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                <cylinderGeometry args={[0.08, 0.02, 0.03, 10, 1, true]} />
                <meshStandardMaterial color="#cbd5e0" side={THREE.DoubleSide} metalness={0.9} />
              </mesh>
            </group>
          </group>
        )}

        {theme === 'hospital' && (
          /* Render Sleek Futuristic Mag-Lev Clinical Dispenser Capsule Robot */
          <group position={[0, 0.12, 0]}>
            {/* 1. Futuristic Floating Magnetic Base (Floats 0.12 in the air) */}
            <mesh position={[0, -0.06, 0]} castShadow>
              <cylinderGeometry args={[0.18, 0.20, 0.05, 16]} />
              <meshStandardMaterial color="#e2e8f0" metalness={0.8} roughness={0.1} />
            </mesh>
            {/* Glowing neon underglow scanner ring */}
            <mesh position={[0, -0.086, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.12, 0.18, 16]} />
              <meshBasicMaterial color="#00ffff" transparent opacity={0.8} blending={THREE.AdditiveBlending} />
            </mesh>

            {/* 2. Sleek vertical white gantry body */}
            <mesh position={[0, 0.06, 0]} castShadow>
              <cylinderGeometry args={[0.15, 0.16, 0.20, 16]} />
              <meshStandardMaterial color="#ffffff" roughness={0.1} />
            </mesh>
            {/* Glowing health vitals diagnostic cross */}
            <group position={[0, 0.06, -0.154]}>
              <mesh>
                <boxGeometry args={[0.024, 0.08, 0.01]} />
                <meshBasicMaterial color="#ff3b30" />
              </mesh>
              <mesh rotation={[0, 0, Math.PI / 2]}>
                <boxGeometry args={[0.024, 0.08, 0.01]} />
                <meshBasicMaterial color="#ff3b30" />
              </mesh>
            </group>

            {/* 3. Transparent Glass Diagnostic Dome Head */}
            <mesh position={[0, 0.22, 0]} castShadow>
              <sphereGeometry args={[0.15, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshStandardMaterial color="#e2e8f0" opacity={0.35} transparent roughness={0.05} metalness={0.9} />
            </mesh>

            {/* 4. Active Revolving Medicine Vial Carousel cylinder inside the head! */}
            <group ref={sensorSpinRef} position={[0, 0.15, 0]}>
              {/* Central carousel base axle */}
              <mesh castShadow>
                <cylinderGeometry args={[0.02, 0.02, 0.06, 8]} />
                <meshStandardMaterial color="#cbd5e0" metalness={0.9} />
              </mesh>
              {/* Rotating capsules circle inside head! */}
              {Array.from({ length: 6 }).map((_, i) => {
                const angle = (i / 6) * Math.PI * 2;
                const xVal = Math.cos(angle) * 0.08;
                const zVal = Math.sin(angle) * 0.08;
                return (
                  <mesh key={i} position={[xVal, 0.04, zVal]} castShadow>
                    <cylinderGeometry args={[0.012, 0.012, 0.05, 6]} />
                    <meshStandardMaterial color={i % 3 === 0 ? "#ff3b30" : (i % 3 === 1 ? "#3182ce" : "#38a169")} roughness={0.1} />
                  </mesh>
                );
              })}
            </group>
          </group>
        )}
      </group>
    </group>
  );
};

// Realistic Dynamic Obstacle (City supercar or Warehouse Forklift or Martian Dust storm funnel or Hospital Nurse staff cart)
const CityCarObstacle3D = ({ position, theme = 'city' }) => {
  const wheelRef = useRef();

  useFrame(({ clock }) => {
    if (wheelRef.current) wheelRef.current.rotation.x = clock.getElapsedTime() * 9.5;
  });

  if (theme === 'warehouse') {
    // Red Automated Industrial Forklift (Ağır Hizmet Forklift)
    return (
      <group position={position}>
        {/* Red metal mainframe chassis */}
        <mesh position={[0, 0.08, 0]} castShadow>
          <boxGeometry args={[0.42, 0.12, 0.54]} />
          <meshStandardMaterial color="#e53e3e" metalness={0.6} roughness={0.3} />
        </mesh>
        
        {/* Safety roll cage posts */}
        {[-0.18, 0.18].map((x, idx1) =>
          [-0.18, 0.18].map((z, idx2) => (
            <mesh key={`${idx1}-${idx2}`} position={[x, 0.22, z]}>
              <cylinderGeometry args={[0.01, 0.01, 0.22, 6]} />
              <meshStandardMaterial color="#1a202c" metalness={0.8} />
            </mesh>
          ))
        )}
        {/* Roof safety plate */}
        <mesh position={[0, 0.33, 0]}>
          <boxGeometry args={[0.40, 0.015, 0.40]} />
          <meshStandardMaterial color="#1a202c" />
        </mesh>

        {/* Front metal mast guide & lifting forks */}
        <mesh position={[0, 0.18, -0.28]} castShadow>
          <boxGeometry args={[0.22, 0.32, 0.02]} />
          <meshStandardMaterial color="#cbd5e0" metalness={0.9} roughness={0.1} />
        </mesh>
        {/* Left/Right forks extending forward */}
        {[-0.08, 0.08].map((x, idx) => (
          <mesh key={idx} position={[x, 0.03, -0.38]}>
            <boxGeometry args={[0.03, 0.015, 0.24]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.9} />
          </mesh>
        ))}

        {/* Load crate on the forks */}
        <mesh position={[0, 0.08, -0.38]} castShadow>
          <boxGeometry args={[0.24, 0.14, 0.20]} />
          <meshStandardMaterial color="#ecc94b" roughness={0.8} />
        </mesh>

        {/* Utility tires */}
        {[-0.22, 0.22].map((x, i) =>
          [-0.18, 0.18].map((z, j) => (
            <mesh
              key={`${i}-${j}`}
              ref={i === 0 && j === 0 ? wheelRef : null}
              position={[x, 0.04, z]}
              rotation={[0, 0, Math.PI / 2]}
              castShadow
            >
              <cylinderGeometry args={[0.09, 0.09, 0.06, 12]} />
              <meshStandardMaterial color="#1a202c" roughness={0.9} />
            </mesh>
          ))
        )}
      </group>
    );
  }

  if (theme === 'mars') {
    // Futuristic Quadcopter Planetary Survey Drone (Uçan Keşif İnsansız Hava Aracı)
    return (
      <group position={position}>
        {/* Drone hovering height base anchor */}
        <group position={[0, 0.44, 0]}>
          {/* Central chrome metal sphere body core */}
          <mesh castShadow>
            <sphereGeometry args={[0.11, 16, 12]} />
            <meshStandardMaterial color="#cbd5e0" roughness={0.05} metalness={0.95} />
          </mesh>
          {/* Realistic gold NASA optical sensor lens on front */}
          <mesh position={[0, -0.03, -0.11]}>
            <sphereGeometry args={[0.024, 8, 8]} />
            <meshStandardMaterial color="#d69e2e" metalness={0.9} roughness={0.1} />
          </mesh>

          {/* 4 Carbon-fiber Quad arms extending outwards */}
          {[-0.14, 0.14].map((xVal, idx1) =>
            [-0.14, 0.14].map((zVal, idx2) => {
              const armDir = new THREE.Vector3(xVal, 0, zVal).normalize();
              const dist = 0.18;
              return (
                <group key={`${idx1}-${idx2}`} position={[armDir.x * dist, 0, armDir.z * dist]}>
                  {/* Slender arm connector */}
                  <mesh rotation={[Math.PI / 2, 0, Math.atan2(armDir.x, armDir.z)]} castShadow>
                    <cylinderGeometry args={[0.008, 0.008, dist, 6]} />
                    <meshStandardMaterial color="#1a202c" roughness={0.5} />
                  </mesh>
                  {/* Thruster motor cylinder pod */}
                  <mesh position={[0, 0.02, 0]} castShadow>
                    <cylinderGeometry args={[0.026, 0.026, 0.04, 8]} />
                    <meshStandardMaterial color="#4a5568" metalness={0.8} />
                  </mesh>
                  {/* Realistic titanium thruster exhaust nozzle (no neon cyan glow!) */}
                  <mesh position={[0, -0.01, 0]} castShadow>
                    <cylinderGeometry args={[0.014, 0.008, 0.015, 6]} />
                    <meshStandardMaterial color="#2d3748" metalness={0.9} roughness={0.2} />
                  </mesh>
                  
                  {/* Fast Spinning Propeller Rotor Blade */}
                  <mesh ref={idx1 === 0 && idx2 === 0 ? wheelRef : null} position={[0, 0.041, 0]}>
                    <boxGeometry args={[0.18, 0.005, 0.015]} />
                    <meshStandardMaterial color="#1a202c" roughness={0.3} />
                  </mesh>
                </group>
              );
            })
          )}

          {/* Emitter antenna on top */}
          <mesh position={[0, 0.14, 0]} castShadow>
            <cylinderGeometry args={[0.004, 0.004, 0.08, 4]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.9} />
          </mesh>
          {/* Dim warm-amber telemetry warning light */}
          <mesh position={[0, 0.18, 0]}>
            <sphereGeometry args={[0.012, 6, 6]} />
            <meshBasicMaterial color="#ff9f1c" />
          </mesh>
        </group>

        {/* Downward cone projection represents active terrain scanning laser (extremely subtle warm-amber!) */}
        <mesh position={[0, 0.22, 0]} rotation={[0, 0, 0]}>
          <cylinderGeometry args={[0.01, 0.32, 0.44, 8, 1, true]} />
          <meshBasicMaterial
            color="#d69e2e"
            transparent
            opacity={0.03}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        
        {/* Scanning laser circle highlight on the sand (very soft warm-amber) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <ringGeometry args={[0.26, 0.30, 16]} />
          <meshBasicMaterial color="#d69e2e" transparent opacity={0.12} blending={THREE.AdditiveBlending} />
        </mesh>
      </group>
    );
  }

  if (theme === 'hospital') {
    // Healthcare Professional pushing a clinical mobile IV equipment trolley
    return (
      <group position={position}>
        {/* Nurse / Doctor capsule body in clean turquoise scrub */}
        <mesh position={[0.08, 0.26, 0.0]} castShadow>
          <capsuleGeometry args={[0.08, 0.32, 4, 8]} />
          <meshStandardMaterial color="#319795" roughness={0.3} />
        </mesh>
        {/* Round head */}
        <mesh position={[0.08, 0.48, 0.0]} castShadow>
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshStandardMaterial color="#f7fafc" roughness={0.5} />
        </mesh>

        {/* Stainless Steel Mobile Medical Cart Trolley */}
        <mesh position={[-0.12, 0.22, 0.0]} castShadow>
          <boxGeometry args={[0.16, 0.36, 0.24]} />
          <meshStandardMaterial color="#cbd5e0" metalness={0.8} roughness={0.2} />
        </mesh>
        
        {/* Glowing clinical diagnostics monitor on the cart */}
        <mesh position={[-0.12, 0.43, 0.0]} castShadow>
          <boxGeometry args={[0.12, 0.08, 0.16]} />
          <meshStandardMaterial color="#2d3748" />
        </mesh>
        <mesh position={[-0.12, 0.43, 0.082]}>
          <planeGeometry args={[0.08, 0.06]} />
          <meshBasicMaterial color="#00ffff" />
        </mesh>

        {/* Small trolley wheels */}
        {[-0.18, -0.06].map((x) =>
          [-0.10, 0.10].map((z, idx) => (
            <mesh key={`${x}-${z}-${idx}`} position={[x, 0.02, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.03, 0.03, 0.02, 8]} />
              <meshStandardMaterial color="#1a202c" />
            </mesh>
          ))
        )}
      </group>
    );
  }

  // Original City sedan sports car
  return (
    <group position={position}>
      {/* 1. Red Metallic Sports Car Chassis */}
      <mesh castShadow receiveShadow position={[0, 0.09, 0]}>
        <boxGeometry args={[0.58, 0.13, 0.76]} />
        <meshStandardMaterial color="#e53e3e" roughness={0.2} metalness={0.8} />
      </mesh>

      {/* Sports cabin */}
      <mesh position={[0, 0.18, -0.04]} castShadow>
        <boxGeometry args={[0.46, 0.10, 0.44]} />
        <meshStandardMaterial color="#2d3748" roughness={0.1} metalness={0.6} />
      </mesh>

      {/* Glass windshield windows */}
      <mesh position={[0, 0.18, -0.04]}>
        <boxGeometry args={[0.466, 0.09, 0.43]} />
        <meshStandardMaterial color="#1a202c" roughness={0.0} metalness={1.0} />
      </mesh>

      {/* Front Yellowish Headlights */}
      {[-0.18, 0.18].map((x, idx) => (
        <mesh key={idx} position={[x, 0.10, -0.39]}>
          <boxGeometry args={[0.05, 0.02, 0.015]} />
          <meshStandardMaterial color="#fffff0" emissive="#fffff0" emissiveIntensity={1.8} />
        </mesh>
      ))}

      {/* Rubber Tires */}
      {[-0.30, 0.30].map((x, i) =>
        [-0.18, 0.18].map((z, j) => (
          <mesh
            key={`${i}-${j}`}
            ref={i === 0 && j === 0 ? wheelRef : null}
            position={[x, 0.02, z]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow
          >
            <cylinderGeometry args={[0.11, 0.11, 0.05, 12]} />
            <meshStandardMaterial color="#1a202c" roughness={0.9} />
          </mesh>
        ))
      )}
    </group>
  );
};

// Floating dust particles to simulate ambient city dust/sparks in the air
const FloatingDustParticles = ({ count = 50, theme = 'city' }) => {
  const pointsRef = useRef();
  const finalCount = theme === 'mars' ? 80 : count; // 80 count instead of 160 to solve lag completely

  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < finalCount; i++) {
      const isMars = theme === 'mars';
      temp.push({
        pos: new THREE.Vector3(
          (Math.random() - 0.5) * (isMars ? 18.0 : 16.0),
          Math.random() * (isMars ? 2.5 : 4.5) + 0.1,
          (Math.random() - 0.5) * 16.0
        ),
        speedY: 0.12 + Math.random() * 0.15,
        speedX: isMars ? (0.6 + Math.random() * 0.8) : ((Math.random() - 0.5) * 0.08),
        speedZ: (Math.random() - 0.5) * 0.08,
        size: isMars ? (0.045 + Math.random() * 0.055) : (0.015 + Math.random() * 0.02), // doubled particle sizes for dense look
        phase: Math.random() * Math.PI * 2
      });
    }
    return temp;
  }, [finalCount, theme]);

  useFrame((state, delta) => {
    if (!pointsRef.current) return;
    const t = state.clock.getElapsedTime();
    const children = pointsRef.current.children;
    particles.forEach((p, idx) => {
      const mesh = children[idx];
      if (mesh) {
        if (theme === 'mars') {
          // Strong horizontal sandstorm wind drift across the desert plane
          p.pos.x += p.speedX * delta * 5.0;
          p.pos.y += Math.sin(t * 1.5 + p.phase) * 0.0008;
          p.pos.z += Math.cos(t * 0.8 + p.phase) * 0.0015;
          
          if (p.pos.x > 9.0) p.pos.x = -9.0;
        } else {
          // Standard vertical drift (ambient air dust)
          p.pos.y += p.speedY * 0.008;
          p.pos.x += Math.sin(t + p.phase) * 0.0015;
          p.pos.z += Math.cos(t + p.phase) * 0.0015;
          
          if (p.pos.y > 4.5) p.pos.y = 0.1;
        }
        mesh.position.copy(p.pos);
        mesh.material.opacity = theme === 'mars' ? (0.35 + Math.sin(t * 1.2 + p.phase) * 0.18) : (0.2 + Math.sin(t * 1.5 + p.phase) * 0.12);
      }
    });
  });

  const particleColor = useMemo(() => {
    if (theme === 'mars') return '#ff7a00'; // Rusty glowing sandstorm orange
    if (theme === 'warehouse') return '#cbd5e0'; // Grey factory dust
    if (theme === 'hospital') return '#e2e8f0'; // Clinical sterile mist
    return '#4fd1c5'; // City neon teal spark
  }, [theme]);

  return (
    <group ref={pointsRef}>
      {particles.map((p, idx) => (
        <mesh key={idx} position={p.pos}>
          <boxGeometry args={[p.size, p.size, p.size]} />
          <meshBasicMaterial color={particleColor} transparent opacity={theme === 'mars' ? 0.35 : 0.25} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
    </group>
  );
};

// Realistic Warm Streetlight or Industrial Halogen Spotlight or Martian Navigational Solar Beacon
const StreetLight3D = ({ position, theme = 'city' }) => {
  const lampColor = useMemo(() => {
    if (theme === 'warehouse') return '#ffeaad'; // Industrial halogen
    if (theme === 'mars') return '#00ffcc'; // Cyber cyan
    if (theme === 'hospital') return '#e0f7fa'; // Sanitary clean light
    return '#ffe8cc'; // Warm sunset street lamp
  }, [theme]);

  if (theme === 'mars') {
    // Navigational solar beacons (no streetlights on Mars!)
    return (
      <group position={position}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <cylinderGeometry args={[0.008, 0.01, 0.6, 6]} />
          <meshStandardMaterial color="#4a5568" metalness={0.9} />
        </mesh>
        {/* Glowing beacon crystal */}
        <mesh position={[0, 0.61, 0]}>
          <sphereGeometry args={[0.024, 6, 6]} />
          <meshStandardMaterial color="#00ffcc" emissive="#00ffcc" emissiveIntensity={2.5} /> {/* high optimized glow */}
        </mesh>
      </group>
    );
  }

  // Classic streetlight structure scaled or adapted nicely
  return (
    <group position={position}>
      {/* Dark metallic pole */}
      <mesh position={[0, 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.015, 0.015, 0.8, 8]} />
        <meshStandardMaterial color={theme === 'hospital' ? '#cbd5e0' : '#4a5568'} metalness={0.7} roughness={0.2} />
      </mesh>
      
      {/* Horizontal light bracket arm */}
      <mesh position={[0.05, 0.8, 0]} castShadow>
        <boxGeometry args={[0.12, 0.02, 0.02]} />
        <meshStandardMaterial color={theme === 'hospital' ? '#cbd5e0' : '#4a5568'} metalness={0.7} />
      </mesh>
      
      {/* Glowing light head */}
      <mesh position={[0.10, 0.78, 0]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshBasicMaterial color="#fffcf0" />
      </mesh>
      
      {/* Spotlight */}
      <pointLight
        position={[0.10, 0.74, 0]}
        intensity={1.2}
        distance={3.2}
        color={lampColor}
      />
    </group>
  );
};

// Realistic Brick/Concrete Building or Heavy Duty Pallet Rack or Mars Geodesic Research Dome or Medical Diagnostic Machine
const CityBuilding3D = ({ position, seed, theme = 'city' }) => {
  const coreRef = useRef();
  
  useFrame(({ clock }) => {
    if (theme === 'hospital' && coreRef.current) {
      coreRef.current.rotation.y = clock.getElapsedTime() * 4.0; // Spin inner magnetic core scanner ring!
    }
  });

  const buildingHeight = useMemo(() => 1.4 + (seed % 3) * 0.25, [seed]);

  const buildingColor = useMemo(() => {
    const colors = [
      '#fcf8f2', '#f6ad55', '#fc8181', '#ecc94b', '#48bb78', '#319795',
      '#4299e1', '#a0aec0', '#b794f4', '#e53e3e', '#ed8936', '#718096',
    ];
    return colors[seed % colors.length];
  }, [seed]);

  if (theme === 'warehouse') {
    const seedVal = seed % 4;

    if (seedVal === 0) {
      // 📦 1. Heavy Industrial Pallet Rack (Depo Rafı)
      return (
        <group position={[position[0], 0, position[2]]}>
          {/* Concrete sidewalk pad beneath the rack */}
          <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[0.96, 0.96]} />
            <meshStandardMaterial color="#cbd5e0" roughness={0.9} />
          </mesh>

          {/* Vertical blue steel support frames */}
          {[-0.42, 0.42].map((x, idx1) =>
            [-0.42, 0.42].map((z, idx2) => (
              <mesh key={`${idx1}-${idx2}`} position={[x, 0.7, z]} castShadow>
                <boxGeometry args={[0.05, 1.4, 0.05]} />
                <meshStandardMaterial color="#2b6cb0" roughness={0.4} metalness={0.6} />
              </mesh>
            ))
          )}

          {/* Orange horizontal crossbars */}
          <mesh position={[0, 0.52, 0]} castShadow>
            <boxGeometry args={[0.88, 0.04, 0.88]} />
            <meshStandardMaterial color="#dd6b20" roughness={0.4} metalness={0.5} />
          </mesh>
          <mesh position={[0, 1.12, 0]} castShadow>
            <boxGeometry args={[0.88, 0.04, 0.88]} />
            <meshStandardMaterial color="#dd6b20" roughness={0.4} metalness={0.5} />
          </mesh>

          {/* Cargo Boxes / Pallets on Lower Level */}
          <mesh position={[-0.20, 0.28, 0.0]} castShadow>
            <boxGeometry args={[0.34, 0.44, 0.34]} />
            <meshStandardMaterial color="#8b5a2b" roughness={0.9} />
          </mesh>
          <mesh position={[0.20, 0.28, -0.15]} castShadow>
            <boxGeometry args={[0.32, 0.42, 0.32]} />
            <meshStandardMaterial color="#d69e2e" roughness={0.8} />
          </mesh>

          {/* Cargo boxes stacked on Level 1 Shelf */}
          <mesh position={[-0.18, 0.74, 0.12]} castShadow>
            <boxGeometry args={[0.32, 0.36, 0.32]} />
            <meshStandardMaterial color="#4a5568" roughness={0.8} />
          </mesh>
          <mesh position={[0.18, 0.74, -0.12]} castShadow>
            <boxGeometry args={[0.30, 0.34, 0.30]} />
            <meshStandardMaterial color="#b794f4" roughness={0.8} />
          </mesh>

          {/* Cargo boxes stacked on Level 2 Shelf */}
          <mesh position={[0, 1.30, 0]} castShadow>
            <boxGeometry args={[0.36, 0.30, 0.36]} />
            <meshStandardMaterial color="#e53e3e" roughness={0.8} />
          </mesh>
        </group>
      );
    }

    if (seedVal === 1) {
      // ⚡ 2. Cybernetic Charging Station Hub (Şarj İstasyonu)
      return (
        <group position={[position[0], 0, position[2]]}>
          {/* Safety yellow-black hazard base plate */}
          <mesh position={[0, 0.01, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.88, 0.02, 0.88]} />
            <meshStandardMaterial color="#ecc94b" roughness={0.4} />
          </mesh>
          {/* Main charging terminal cabinet */}
          <mesh position={[0, 0.38, 0]} castShadow>
            <boxGeometry args={[0.42, 0.74, 0.42]} />
            <meshStandardMaterial color="#2d3748" metalness={0.8} roughness={0.2} />
          </mesh>
          {/* Coiled copper heavy power cables */}
          {[-0.18, 0.18].map((xVal, idx) => (
            <mesh key={idx} position={[xVal, 0.20, 0]} rotation={[0, 0, idx === 0 ? 0.3 : -0.3]} castShadow>
              <cylinderGeometry args={[0.015, 0.02, 0.38, 8]} />
              <meshStandardMaterial color="#b7791f" metalness={0.7} />
            </mesh>
          ))}
          {/* Active charging batteries glowing green */}
          {[-0.08, 0.08].map((zVal, idx) => (
            <mesh key={idx} position={[0, 0.42, zVal]} castShadow>
              <cylinderGeometry args={[0.08, 0.08, 0.16, 8]} />
              <meshStandardMaterial color="#48bb78" emissive="#38a169" emissiveIntensity={1.8} roughness={0.1} />
            </mesh>
          ))}
          {/* Glowing blue progress indicators screen */}
          <mesh position={[0, 0.60, 0.212]}>
            <planeGeometry args={[0.26, 0.12]} />
            <meshBasicMaterial color="#00ffcc" />
          </mesh>
        </group>
      );
    }

    if (seedVal === 2) {
      // 🏗️ 3. High-Tech Cargo Sorting conveyor Terminal
      return (
        <group position={[position[0], 0, position[2]]}>
          {/* Support legs */}
          {[-0.38, 0.38].map((x) =>
            [-0.38, 0.38].map((z, idx) => (
              <mesh key={`${x}-${z}-${idx}`} position={[x, 0.18, z]} castShadow>
                <cylinderGeometry args={[0.02, 0.02, 0.36, 6]} />
                <meshStandardMaterial color="#718096" metalness={0.8} />
              </mesh>
            ))
          )}
          {/* Conveyor deck platform */}
          <mesh position={[0, 0.38, 0]} castShadow>
            <boxGeometry args={[0.90, 0.04, 0.90]} />
            <meshStandardMaterial color="#4a5568" metalness={0.7} roughness={0.4} />
          </mesh>
          {/* Roller belts on conveyor deck */}
          {[-0.3, -0.1, 0.1, 0.3].map((zVal, idx) => (
            <mesh key={idx} position={[0, 0.41, zVal]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.015, 0.015, 0.82, 8]} />
              <meshStandardMaterial color="#cbd5e0" metalness={0.9} />
            </mesh>
          ))}
          {/* Overhead cargo scanning barcode scanner ring */}
          <group position={[0, 0.64, 0]}>
            <mesh castShadow>
              <boxGeometry args={[0.82, 0.03, 0.16]} />
              <meshStandardMaterial color="#1a202c" />
            </mesh>
            {/* Glowing laser scanning curtain line */}
            <mesh position={[0, -0.10, 0]}>
              <cylinderGeometry args={[0.005, 0.005, 0.20, 4, 1, true]} />
              <meshBasicMaterial color="#ff0055" transparent opacity={0.65} />
            </mesh>
          </group>
          {/* Shipping box cargo ready for conveyor belt */}
          <mesh position={[0.1, 0.48, 0]} castShadow>
            <boxGeometry args={[0.26, 0.16, 0.26]} />
            <meshStandardMaterial color="#c6905d" roughness={0.9} />
          </mesh>
        </group>
      );
    }

    // 🧪 4. Industrial Hazard Chemical Liquid Tank Silo
    return (
      <group position={[position[0], 0, position[2]]}>
        {/* Reinforced concrete foundation pad */}
        <mesh position={[0, 0.01, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.88, 0.02, 0.88]} />
          <meshStandardMaterial color="#718096" roughness={0.7} />
        </mesh>
        {/* Main Silver Steel Tank Cylindrical body */}
        <mesh position={[0, 0.46, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.28, 0.90, 16]} />
          <meshStandardMaterial color="#cbd5e0" metalness={0.9} roughness={0.1} />
        </mesh>
        {/* Safety structural cage framing */}
        {[-0.32, 0.32].map((xVal, idx) => (
          <mesh key={idx} position={[xVal, 0.46, 0]} castShadow>
            <cylinderGeometry args={[0.01, 0.015, 0.92, 6]} />
            <meshStandardMaterial color="#4a5568" metalness={0.8} />
          </mesh>
        ))}
        {/* Active fluorescent chemical level gauge tube */}
        <mesh position={[0, 0.46, 0.284]} castShadow>
          <cylinderGeometry args={[0.018, 0.018, 0.62, 6]} />
          <meshStandardMaterial color="#e6fffa" transparent opacity={0.3} roughness={0.05} />
        </mesh>
        {/* Glowing fluid column inside the gauge */}
        <mesh position={[0, 0.38, 0.286]}>
          <cylinderGeometry args={[0.012, 0.012, 0.46, 6]} />
          <meshStandardMaterial color="#38a169" emissive="#00ff66" emissiveIntensity={1.9} />
        </mesh>
        {/* Tank top pressure valve hatch */}
        <mesh position={[0, 0.92, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.04, 10]} />
          <meshStandardMaterial color="#1a202c" metalness={0.9} />
        </mesh>
      </group>
    );
  }

  if (theme === 'mars') {
    const seedVal = seed % 4;

    if (seedVal === 0) {
      // 📡 1. Extraterrestrial Geodesic Research Dome Pod (Mars Habitat)
      return (
        <group position={[position[0], 0, position[2]]}>
          {/* Ground sand foundation */}
          <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <circleGeometry args={[0.48, 16]} />
            <meshStandardMaterial color="#c05621" roughness={0.9} />
          </mesh>
          {/* Geodesic Dome structure */}
          <mesh position={[0, 0.28, 0]} castShadow>
            <sphereGeometry args={[0.42, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#edf2f7" roughness={0.1} metalness={0.9} />
          </mesh>
          {/* Futuristic glowing solar arrays on top */}
          <mesh position={[0, 0.44, 0]} rotation={[0, 0, 0.2]}>
            <boxGeometry args={[0.54, 0.02, 0.14]} />
            <meshStandardMaterial color="#1a365d" roughness={0.05} metalness={0.95} />
          </mesh>
          {/* Warm Home-style Window Bands (Scientific habitat interior light, no neon cyan!) */}
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.36, 0.36, 0.04, 12, 1, true]} />
            <meshBasicMaterial color="#ffe8cc" transparent opacity={0.35} />
          </mesh>
          {/* Communication Antenna spire */}
          <mesh position={[0, 0.54, 0]} castShadow>
            <cylinderGeometry args={[0.008, 0.015, 0.26, 6]} />
            <meshStandardMaterial color="#a0aec0" metalness={0.9} />
          </mesh>
        </group>
      );
    }

    if (seedVal === 1) {
      // ☀️ 2. Scientific Heliostat Solar Tracker Mirror Tower (Güneş İzleme Aynası)
      return (
        <group position={[position[0], 0, position[2]]}>
          {/* Support pillar */}
          <mesh position={[0, 0.20, 0]} castShadow>
            <cylinderGeometry args={[0.02, 0.03, 0.40, 8]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.9} roughness={0.1} />
          </mesh>
          {/* Mirror mount swivel frame */}
          <mesh position={[0, 0.40, 0]} rotation={[0.4, 0.3, 0.5]} castShadow>
            <boxGeometry args={[0.48, 0.012, 0.36]} />
            <meshStandardMaterial color="#cbd5e0" metalness={0.95} roughness={0.0} />
          </mesh>
          {/* Blinking warm-amber status / tracking LED */}
          <mesh position={[0, 0.42, 0]}>
            <sphereGeometry args={[0.025, 8, 8]} />
            <meshBasicMaterial color="#ff9f1c" />
          </mesh>
        </group>
      );
    }

    if (seedVal === 2) {
      // ☄️ 3. Meteor Impact Crater (Mini Göktaşı Krateri)
      return (
        <group position={[position[0], 0, position[2]]}>
          {/* Ground crater rim wall */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]} castShadow receiveShadow>
            <ringGeometry args={[0.18, 0.46, 16]} />
            <meshStandardMaterial color="#8c3e1e" roughness={0.95} />
          </mesh>
          {/* Central depressed dark crater floor */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow>
            <circleGeometry args={[0.18, 16]} />
            <meshStandardMaterial color="#3a1608" roughness={0.99} />
          </mesh>
          {/* Tiny ejecta rocks scattered */}
          <mesh position={[0.22, 0.02, -0.16]} rotation={[0.5, 0.2, 0.1]} castShadow>
            <dodecahedronGeometry args={[0.045, 0]} />
            <meshStandardMaterial color="#54210e" />
          </mesh>
          <mesh position={[-0.24, 0.015, 0.20]} rotation={[0.1, 0.5, 0.7]} castShadow>
            <dodecahedronGeometry args={[0.035, 0]} />
            <meshStandardMaterial color="#3a1608" />
          </mesh>
        </group>
      );
    }

    // 🪨 4. Iron-rich Basalt Column & Volcanic Rock Outcropping (Basalt Sütunları ve Volkanik Kayalar)
    return (
      <group position={[position[0], 0, position[2]]}>
        {/* Ground volcanic debris base */}
        <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.22, 0.28, 0.06, 8]} />
          <meshStandardMaterial color="#3a1608" roughness={0.95} />
        </mesh>
        {/* Main tall hexagonal basalt column */}
        <mesh position={[0, 0.32, 0]} rotation={[0.06, 0.05, 0.02]} castShadow>
          <cylinderGeometry args={[0.068, 0.076, 0.64, 6]} />
          <meshStandardMaterial color="#2d3748" metalness={0.3} roughness={0.9} />
        </mesh>
        {/* Medium secondary basalt column with weathered rusted iron oxide tip */}
        <mesh position={[-0.10, 0.22, 0.08]} rotation={[-0.12, 0.1, -0.08]} castShadow>
          <cylinderGeometry args={[0.054, 0.062, 0.44, 6]} />
          <meshStandardMaterial color="#3a2512" roughness={0.92} />
        </mesh>
        {/* Small volcanic craggy stone with rich iron-ore veins (deep subtle rust glow) */}
        <mesh position={[0.10, 0.12, -0.08]} rotation={[0.22, -0.15, 0.14]} castShadow>
          <dodecahedronGeometry args={[0.12, 0]} />
          <meshStandardMaterial 
            color="#2d3748" 
            emissive="#5a1805" 
            emissiveIntensity={0.6} 
            roughness={0.95} 
          />
        </mesh>
      </group>
    );
  }

  if (theme === 'hospital') {
    const seedVal = seed % 4;

    if (seedVal === 0) {
      // 🏥 1. Advanced Hollow MRI / CT Scanner Machine
      return (
        <group position={[position[0], 0, position[2]]}>
          {/* Base concrete pedestal plate */}
          <mesh position={[0, 0.01, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.90, 0.02, 0.90]} />
            <meshStandardMaterial color="#edf2f7" roughness={0.4} />
          </mesh>

          {/* Hollow Scanner Bore Core Gantry (Dairesel Cihaz Gövdesi) */}
          <group position={[0, 0.42, 0.16]}>
            {/* Main White Scanner Ring Body */}
            <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.34, 0.34, 0.28, 16]} />
              <meshStandardMaterial color="#ffffff" roughness={0.15} metalness={0.2} />
            </mesh>
            {/* Dark inner scan tunnel bore (Hollow visual center) */}
            <mesh position={[0, 0, -0.01]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.20, 0.20, 0.302, 16]} />
              <meshStandardMaterial color="#1a202c" roughness={0.8} />
            </mesh>
            {/* Active Revolving Translucent Magnetic Core Scanner Ring inside tunnel */}
            <mesh ref={coreRef} position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.202, 0.202, 0.20, 16, 1, true]} />
              <meshStandardMaterial color="#00ffff" emissive="#0088cc" emissiveIntensity={1.8} transparent opacity={0.4} side={THREE.DoubleSide} />
            </mesh>
            {/* Glowing laser telemetry ring inside the bore */}
            <mesh position={[0, 0, 0.06]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.204, 0.204, 0.015, 16, 1, true]} />
              <meshBasicMaterial color="#00ffcc" />
            </mesh>
            {/* Chrome decorative face trim */}
            <mesh position={[0, 0, 0.144]} rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.20, 0.34, 16]} />
              <meshStandardMaterial color="#cbd5e0" metalness={0.9} roughness={0.05} />
            </mesh>
          </group>

          {/* Patient Sliding Scanner Examination Bed */}
          <group position={[0, 0.02, -0.22]}>
            {/* White metal sliding support pedestal */}
            <mesh position={[0, 0.11, 0]} castShadow>
              <boxGeometry args={[0.26, 0.22, 0.38]} />
              <meshStandardMaterial color="#ffffff" roughness={0.2} />
            </mesh>
            {/* Shiny chrome sliding rails */}
            {[-0.10, 0.10].map((xVal, idx) => (
              <mesh key={idx} position={[xVal, 0.22, 0.08]} castShadow>
                <boxGeometry args={[0.015, 0.015, 0.44]} />
                <meshStandardMaterial color="#cbd5e0" metalness={0.9} />
              </mesh>
            ))}
            {/* Patient scan mattress sliding bed extending right into the hollow bore */}
            <mesh position={[0, 0.23, 0.18]} castShadow>
              <boxGeometry args={[0.20, 0.03, 0.62]} />
              <meshStandardMaterial color="#e2e8f0" roughness={0.5} />
            </mesh>
            {/* Headrest pillow */}
            <mesh position={[0, 0.252, 0.42]} castShadow>
              <boxGeometry args={[0.16, 0.025, 0.07]} />
              <meshStandardMaterial color="#ffffff" />
            </mesh>
          </group>

          {/* Sleek Clinical LCD Control Panel Panel */}
          <group position={[-0.34, 0.02, -0.12]}>
            {/* Support pillar cabinet */}
            <mesh position={[0, 0.22, 0]} castShadow>
              <boxGeometry args={[0.16, 0.44, 0.16]} />
              <meshStandardMaterial color="#ffffff" roughness={0.2} />
            </mesh>
            {/* Glowing turquoise touchscreen screen */}
<mesh position={[0, 0.45, 0]} rotation={[-0.4, 0, 0]} castShadow>
              <boxGeometry args={[0.18, 0.02, 0.14]} />
              <meshStandardMaterial color="#2d3748" />
            </mesh>
            <mesh position={[0, 0.458, 0]} rotation={[-0.4, 0, 0]}>
              <planeGeometry args={[0.16, 0.12]} />
              <meshBasicMaterial color="#00ffcc" />
            </mesh>
          </group>
        </group>
      );
    }

    if (seedVal === 1) {
      // 🛌 2. Majestic Clinical Hospital Recovery Bed Suite (ICU Unit)
      return (
        <group position={[position[0], 0, position[2]]}>
          {/* Base sterile tile floor plate */}
          <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[0.96, 0.96]} />
            <meshStandardMaterial color="#edf2f7" roughness={0.6} />
          </mesh>

          {/* The Recovery Bed (Upscaled to look majestic and fill the cell!) */}
          <group position={[0.08, 0.02, 0.0]}>
            {/* White metal bed frame */}
            <mesh position={[0, 0.08, 0]} castShadow>
              <boxGeometry args={[0.42, 0.03, 0.82]} />
              <meshStandardMaterial color="#cbd5e0" metalness={0.6} roughness={0.2} />
            </mesh>
            {/* Bed legs */}
            {[-0.18, 0.18].map((xVal, idx1) =>
              [-0.36, 0.36].map((zVal, idx2) => (
                <mesh key={`${idx1}-${idx2}`} position={[xVal, 0.025, zVal]} castShadow>
                  <cylinderGeometry args={[0.015, 0.015, 0.10, 8]} />
                  <meshStandardMaterial color="#cbd5e0" metalness={0.8} />
                </mesh>
              ))
            )}
            {/* Thick, comfortable white clinical mattress */}
            <mesh position={[0, 0.16, 0]} castShadow>
              <boxGeometry args={[0.38, 0.12, 0.80]} />
              <meshStandardMaterial color="#ffffff" roughness={0.9} />
            </mesh>
            {/* Raised comfortable pillow */}
            <mesh position={[0, 0.24, -0.30]} castShadow>
              <boxGeometry args={[0.32, 0.04, 0.16]} />
              <meshStandardMaterial color="#edf2f7" roughness={0.8} />
            </mesh>
            {/* Clinical turquoise folded sheet blanket */}
            <mesh position={[0, 0.222, 0.14]} castShadow>
              <boxGeometry args={[0.384, 0.01, 0.52]} />
              <meshStandardMaterial color="#4fd1c5" roughness={0.6} />
            </mesh>
            {/* Metal headboard & footboard bars */}
            <mesh position={[0, 0.32, -0.41]} castShadow>
              <boxGeometry args={[0.42, 0.26, 0.02]} />
              <meshStandardMaterial color="#cbd5e0" metalness={0.7} />
            </mesh>
            <mesh position={[0, 0.24, 0.41]} castShadow>
              <boxGeometry args={[0.42, 0.14, 0.02]} />
              <meshStandardMaterial color="#cbd5e0" metalness={0.7} />
            </mesh>
          </group>

          {/* Chrome IV Infusion Drip Stand next to the bed */}
          <group position={[0.38, 0, -0.30]}>
            {/* Stand base plate */}
            <mesh position={[0, 0.01, 0]}>
              <cylinderGeometry args={[0.08, 0.09, 0.02, 6]} />
              <meshStandardMaterial color="#4a5568" roughness={0.6} />
            </mesh>
            {/* Chrome pole (taller!) */}
            <mesh position={[0, 0.40, 0]} castShadow>
              <cylinderGeometry args={[0.01, 0.01, 0.80, 6]} />
              <meshStandardMaterial color="#cbd5e0" metalness={0.9} roughness={0.05} />
            </mesh>
            {/* Hanger hooks */}
            <mesh position={[0, 0.78, 0]} rotation={[0, 0, Math.PI / 2]}>
              <boxGeometry args={[0.006, 0.14, 0.012]} />
              <meshStandardMaterial color="#cbd5e0" metalness={0.9} />
            </mesh>
            {/* Suspended IV fluid bag */}
            <mesh position={[-0.06, 0.68, 0]} castShadow>
              <cylinderGeometry args={[0.024, 0.024, 0.10, 8]} />
              <meshStandardMaterial color="#e6fffa" opacity={0.65} transparent roughness={0.05} />
            </mesh>
          </group>

          {/* Massive light-blue hospital privacy curtain backing the bed */}
          <mesh position={[-0.42, 0.36, 0.0]} castShadow>
            <boxGeometry args={[0.02, 0.72, 0.94]} />
            <meshStandardMaterial color="#90cdf4" opacity={0.45} transparent roughness={0.8} />
          </mesh>
        </group>
      );
    }

    if (seedVal === 2) {
      // 🧪 3. Cleanroom Sterile Medicine Cabinet / Storage Unit
      return (
        <group position={[position[0], 0, position[2]]}>
          {/* Base concrete plate */}
          <mesh position={[0, 0.01, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.74, 0.02, 0.48]} />
            <meshStandardMaterial color="#cbd5e0" roughness={0.4} />
          </mesh>
          {/* Main White Cabinet Shell Structure */}
          <mesh position={[0, 0.38, 0]} castShadow>
            <boxGeometry args={[0.64, 0.74, 0.38]} />
            <meshStandardMaterial color="#ffffff" roughness={0.15} />
          </mesh>
          {/* Glass sliding doors */}
          <mesh position={[0, 0.38, 0.192]} castShadow>
            <boxGeometry args={[0.58, 0.64, 0.01]} />
            <meshStandardMaterial color="#cbd5e0" opacity={0.3} transparent roughness={0.05} />
          </mesh>
          {/* Shelf Lines & Multi-colored glowing medicine bottles inside */}
          {[-0.18, 0.06, 0.30].map((yVal, sIdx) => (
            <group key={sIdx} position={[0, yVal, 0]}>
              {/* Internal metallic shelf divider */}
              <mesh position={[0, 0, 0]}>
                <boxGeometry args={[0.58, 0.015, 0.32]} />
                <meshStandardMaterial color="#cbd5e0" metalness={0.7} />
              </mesh>
              {/* Glowing vials/bottles */}
              {[-0.18, -0.06, 0.06, 0.18].map((xVal, bIdx) => (
                <mesh key={bIdx} position={[xVal, 0.05, 0.0]} castShadow>
                  <cylinderGeometry args={[0.022, 0.022, 0.07, 8]} />
                  <meshStandardMaterial
                    color={bIdx % 3 === 0 ? "#00ffcc" : (bIdx % 3 === 1 ? "#ff007f" : "#9900ff")}
                    emissive={bIdx % 3 === 0 ? "#00aa88" : (bIdx % 3 === 1 ? "#aa0055" : "#5500aa")}
                    emissiveIntensity={1.5}
                    roughness={0.05}
                  />
                </mesh>
              ))}
            </group>
          ))}
          {/* Biohazard / Clinical guide label decal */}
          <mesh position={[0, 0.60, 0.194]}>
            <planeGeometry args={[0.16, 0.08]} />
            <meshBasicMaterial color="#319795" />
          </mesh>
        </group>
      );
    }

    // 🤖 4. Advanced Clinical Surgical Robotic Station (da Vinci style)
    return (
      <group position={[position[0], 0, position[2]]}>
        {/* Foundation pad */}
        <mesh position={[0, 0.01, 0]} castShadow receiveShadow>
          <circleGeometry args={[0.42, 12]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.5} />
        </mesh>
        {/* Main robot console pillar */}
        <mesh position={[0, 0.24, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.10, 0.44, 8]} />
          <meshStandardMaterial color="#ffffff" roughness={0.15} />
        </mesh>
        {/* Glowing circular cyber ring decal on base */}
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.26, 0.30, 16]} />
          <meshBasicMaterial color="#00ffcc" transparent opacity={0.6} />
        </mesh>

        {/* 3 Jointed Chrome Mechanical Surgical Arms */}
        {[-1.1, 0, 1.1].map((angle, idx) => {
          const armRadius = 0.18;
          const ax = Math.cos(angle - Math.PI / 2) * armRadius;
          const az = Math.sin(angle - Math.PI / 2) * armRadius;
          return (
            <group key={idx} position={[ax, 0.36, az]} rotation={[0, angle, 0.3]}>
              {/* Arm segment 1 */}
              <mesh position={[0, 0.10, 0]} castShadow>
                <cylinderGeometry args={[0.012, 0.012, 0.20, 6]} />
                <meshStandardMaterial color="#cbd5e0" metalness={0.9} roughness={0.1} />
              </mesh>
              {/* Swivel elbow joint */}
              <mesh position={[0, 0.20, 0]}>
                <sphereGeometry args={[0.025, 8, 8]} />
                <meshStandardMaterial color="#cbd5e0" metalness={0.9} />
              </mesh>
              {/* Arm segment 2 reaching down */}
              <mesh position={[0.06, 0.12, -0.06]} rotation={[0, 0, -0.6]} castShadow>
                <cylinderGeometry args={[0.008, 0.008, 0.18, 6]} />
                <meshStandardMaterial color="#cbd5e0" metalness={0.9} />
              </mesh>
              {/* Glowing surgical sensor light tip */}
              <mesh position={[0.12, 0.04, -0.10]}>
                <sphereGeometry args={[0.012, 6, 6]} />
                <meshBasicMaterial color={idx === 0 ? "#00ffcc" : (idx === 1 ? "#ff007f" : "#ffcc00")} />
              </mesh>
            </group>
          );
        })}

        {/* Swivel mounted diagnostic clinical screen display */}
        <group position={[0, 0.44, -0.08]} rotation={[-0.2, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.32, 0.20, 0.03]} />
            <meshStandardMaterial color="#2d3748" roughness={0.2} />
          </mesh>
          <mesh position={[0, 0, 0.016]}>
            <planeGeometry args={[0.28, 0.16]} />
            <meshBasicMaterial color="#00ffcc" />
          </mesh>
        </group>
      </group>
    );
  }

  // Fallback to original brick/concrete buildings (City Theme)
  return (
    <group position={[position[0], buildingHeight / 2, position[2]]}>

      {/* Light Concrete Sidewalk (Kaldırım) framing the building block perfectly */}
      <mesh position={[0, -buildingHeight / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1.08, 1.08]} />
        <meshStandardMaterial color="#cbd5e0" roughness={0.9} />
      </mesh>

      {/* Main Building Structure (Brick/Concrete look) */}
      <mesh castShadow receiveShadow position={[0, 0, 0]}>
        <boxGeometry args={[0.88, buildingHeight, 0.88]} />
        <meshStandardMaterial color={buildingColor} roughness={0.7} />
      </mesh>

      {/* Concrete structural base border */}
      <mesh position={[0, -buildingHeight / 2 + 0.06, 0]} receiveShadow>
        <boxGeometry args={[0.92, 0.12, 0.92]} />
        <meshStandardMaterial color="#718096" roughness={0.8} />
      </mesh>

      {/* Classical Grid Multi-pane Glass Windows on all 4 faces */}
      {(() => {
        const renderWindowsForFace = (facePos, faceRot) => {
          return (
            <group position={facePos} rotation={faceRot}>
              {[-0.20, 0.20].map((xOffset, xIdx) => 
                [-0.22, 0.22].map((yRatio, yIdx) => {
                  const yPos = buildingHeight * yRatio;
                  return (
                    <group key={`${xIdx}-${yIdx}`} position={[xOffset, yPos, 0.002]}>
                      {/* Dark Blue Reflective Glass Window Pane reflecting warm sunset */}
                      <mesh>
                        <planeGeometry args={[0.20, 0.16]} />
                        <meshStandardMaterial
                          color="#2a4365"
                          roughness={0.05}
                          metalness={0.9}
                        />
                      </mesh>
                      {/* Subtle elegant window framing outline around the pane */}
                      <mesh position={[0, 0, -0.001]}>
                        <planeGeometry args={[0.216, 0.176]} />
                        <meshStandardMaterial color="#1a202c" roughness={0.5} />
                      </mesh>
                    </group>
                  );
                })
              )}
            </group>
          );
        };

        return (
          <group>
            {/* Front Side */}
            {renderWindowsForFace([0, 0, 0.441], [0, 0, 0])}
            {/* Back Side */}
            {renderWindowsForFace([0, 0, -0.441], [0, Math.PI, 0])}
            {/* Left Side */}
            {renderWindowsForFace([-0.441, 0, 0], [0, -Math.PI / 2, 0])}
            {/* Right Side */}
            {renderWindowsForFace([0.441, 0, 0], [0, Math.PI / 2, 0])}
          </group>
        );
      })()}

      {/* Concrete Roof Ledge */}
      <mesh position={[0, buildingHeight / 2 + 0.02, 0]} castShadow>
        <boxGeometry args={[0.92, 0.04, 0.92]} />
        <meshStandardMaterial color="#4a5568" roughness={0.8} />
      </mesh>

      {/* Cozy Chimney (Şömine Bacası) on the roof */}
      <mesh position={[-0.20, buildingHeight / 2 + 0.14, 0.20]} castShadow>
        <boxGeometry args={[0.10, 0.28, 0.10]} />
        <meshStandardMaterial color="#dd6b20" roughness={0.8} />
      </mesh>
      <mesh position={[-0.20, buildingHeight / 2 + 0.29, 0.20]}>
        <boxGeometry args={[0.12, 0.02, 0.12]} />
        <meshStandardMaterial color="#2d3748" />
      </mesh>

      {/* Metal AC Ventilation Unit on the roof */}
      <mesh position={[0.18, buildingHeight / 2 + 0.05, -0.18]} castShadow>
        <boxGeometry args={[0.18, 0.10, 0.18]} />
        <meshStandardMaterial color="#a0aec0" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
};

// Background Highway Traffic (Realistic cars in distant paths)
const BackgroundHighwayTraffic = ({ size }) => {
  const carsCount = 4;
  const highwayX1 = -size / 2 - 4.5;
  const highwayX2 = size / 2 + 4.5;
  const highwayZ1 = -size / 2 - 4.5;
  const highwayZ2 = size / 2 + 4.5;

  const cars = useMemo(() => {
    return Array.from({ length: carsCount }).map((_, idx) => {
      const isVertical = idx >= carsCount / 2;
      return {
        id: idx,
        isVertical,
        fixed: isVertical ? (idx % 2 === 0 ? highwayX1 : highwayX2) : (idx % 2 === 0 ? highwayZ1 : highwayZ2),
        speed: (8 + Math.random() * 4) * (idx % 2 === 0 ? -1 : 1),
        color: idx % 3 === 0 ? '#3182ce' : idx % 3 === 1 ? '#d69e2e' : '#e53e3e',
        offset: -45 + Math.random() * 90
      };
    });
  }, [size, carsCount, highwayX1, highwayX2, highwayZ1, highwayZ2]);

  const carRefs = useRef([]);

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();
    cars.forEach((car, idx) => {
      const ref = carRefs.current[idx];
      if (ref) {
        let currentPos = car.offset + car.speed * elapsed;
        const limit = 45;
        if (currentPos > limit) currentPos = -limit;
        if (currentPos < -limit) currentPos = limit;

        if (car.isVertical) {
          ref.position.set(car.fixed, 0.08, currentPos);
          ref.rotation.set(0, car.speed > 0 ? 0 : Math.PI, 0);
        } else {
          ref.position.set(currentPos, 0.08, car.fixed);
          ref.rotation.set(0, car.speed > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
        }
      }
    });
  });

  return (
    <group>
      {cars.map((car, idx) => (
        <group key={car.id} ref={el => carRefs.current[idx] = el}>
          {/* Realistic sedan car */}
          <mesh castShadow>
            <boxGeometry args={[0.32, 0.11, 0.50]} />
            <meshStandardMaterial color={car.color} roughness={0.3} metalness={0.7} />
          </mesh>
          <mesh position={[0, 0.08, -0.02]} castShadow>
            <boxGeometry args={[0.24, 0.06, 0.24]} />
            <meshStandardMaterial color="#2d3748" roughness={0.1} />
          </mesh>
        </group>
      ))}
    </group>
  );
};

// 3D LiDAR Sensor Laser Rays (Fine visual grid scan lines)
const LiDARBeams = ({ agentPos, calculatedRays }) => {
  if (!agentPos || !calculatedRays.length) return null;

  return (
    <group>
      {calculatedRays.map((ray, idx) => {
        const start = new THREE.Vector3(agentPos[0], 0.25, agentPos[2]);
        const end = new THREE.Vector3(ray.x, 0.25, ray.z);
        const distance = start.distanceTo(end);

        const position = start.clone().lerp(end, 0.5);
        const direction = new THREE.Vector3().subVectors(end, start).normalize();

        const up = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);

        return (
          <group key={idx}>
            <mesh position={position} quaternion={quaternion}>
              <cylinderGeometry args={[0.004, 0.004, distance, 3]} />
              <meshBasicMaterial
                color={ray.hitObstacle ? "#ef4444" : "#10b981"}
                transparent
                opacity={0.25}
              />
            </mesh>
            {ray.hitObstacle && (
              <mesh position={end}>
                <sphereGeometry args={[0.028, 4, 4]} />
                <meshBasicMaterial color="#ef4444" />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
};

// ─── CAMERA MANAGER (SMOOTH CHASE & FIRST PERSON VIEWPORTS) ───
const CameraController = ({ cameraMode, agent3DPos, lastAction, smoothCarPosRef, raceMode, racer1Pos3D, racer2Pos3D, activeRacers3D }) => {
  const { camera } = useThree();
  const currentAngleRef = useRef(0);
  const currentLookAtRef = useRef(null);
  const smoothAgentPosRef = useRef(null);

  // Ref to hold the latest agent3DPos prop to prevent stale closures in useFrame
  const agent3DPosRef = useRef(agent3DPos);
  agent3DPosRef.current = agent3DPos;

  useFrame((state, delta) => {
    // Read directly from the physical car position if available for locked-in tracking
    let targetPos = null;
    if (raceMode) {
      if (activeRacers3D && activeRacers3D.length > 0) {
        let sumX = 0, sumY = 0, sumZ = 0;
        let count = 0;
        activeRacers3D.forEach(r => {
          if (r.pos3D) {
            sumX += r.pos3D[0];
            sumY += r.pos3D[1];
            sumZ += r.pos3D[2];
            count++;
          }
        });
        if (count > 0) {
          targetPos = new THREE.Vector3(sumX / count, sumY / count, sumZ / count);
        }
      }
      if (!targetPos && racer1Pos3D && racer2Pos3D) {
        targetPos = new THREE.Vector3(
          (racer1Pos3D[0] + racer2Pos3D[0]) / 2,
          (racer1Pos3D[1] + racer2Pos3D[1]) / 2,
          (racer1Pos3D[2] + racer2Pos3D[2]) / 2
        );
      }
    } else if (smoothCarPosRef && smoothCarPosRef.current && smoothCarPosRef.current.lengthSq() > 0) {
      targetPos = smoothCarPosRef.current;
    } else if (agent3DPosRef.current) {
      targetPos = new THREE.Vector3(...agent3DPosRef.current);
    }

    if (!targetPos) return;

    if (!smoothAgentPosRef.current) {
      smoothAgentPosRef.current = targetPos.clone();
    } else {
      // Sync look-at perfectly to the smooth moving chassis
      smoothAgentPosRef.current.copy(targetPos);
    }

    let targetAngle = currentAngleRef.current; // Keep current angle by default
    if (lastAction) {
      switch (lastAction.action_label) {
        case 'UP': targetAngle = 0; break;
        case 'DOWN': targetAngle = Math.PI; break;
        case 'LEFT': targetAngle = Math.PI / 2; break;
        case 'RIGHT': targetAngle = -Math.PI / 2; break;
      }
    }

    let diff = targetAngle - currentAngleRef.current;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));

    const lerpSpeed = 5.0; // Slower for beautiful cinematic drag
    currentAngleRef.current += diff * Math.min(delta * lerpSpeed, 1.0);

    const fx = -Math.sin(currentAngleRef.current);
    const fz = -Math.cos(currentAngleRef.current);
    const bx = -fx;
    const bz = -fz;

    let targetCamPos = null;
    let targetLookAt = null;

    if (cameraMode === 'fps') {
      // Physical cockpit rumble: high-frequency motor vibration when active
      const t = state.clock.getElapsedTime();
      const rumbleX = Math.sin(t * 38.0) * 0.0012;
      const rumbleY = Math.cos(t * 38.0) * 0.0012;

      targetCamPos = [
        smoothAgentPosRef.current.x + fx * 0.44 + rumbleX,
        0.34 + rumbleY,
        smoothAgentPosRef.current.z + fz * 0.44
      ];
      targetLookAt = [
        smoothAgentPosRef.current.x + fx * 4.0,
        0.26,
        smoothAgentPosRef.current.z + fz * 4.0
      ];

      camera.position.lerp(new THREE.Vector3(...targetCamPos), Math.min(delta * 12.0, 1.0));
    }
    else if (cameraMode === 'tps') {
      targetCamPos = [
        smoothAgentPosRef.current.x + bx * 3.2,
        1.7,
        smoothAgentPosRef.current.z + bz * 3.2
      ];
      targetLookAt = [
        smoothAgentPosRef.current.x + fx * 1.0,
        0.2,
        smoothAgentPosRef.current.z + fz * 1.0
      ];

      camera.position.lerp(new THREE.Vector3(...targetCamPos), Math.min(delta * 10.0, 1.0));
    }
    else if (cameraMode === 'drone') {
      // Drone floats very high in the sky, looking nearly straight down at the agent
      const droneHeight = 9.0; 
      const droneDist = 1.8;  // Close horizontal distance for nearly vertical bird's-eye perspective
      
      // Amplified wind hover sway at high altitude
      const t = state.clock.getElapsedTime();
      const hoverX = Math.sin(t * 1.0) * 0.32;
      const hoverY = Math.cos(t * 1.3) * 0.22;
      const hoverZ = Math.sin(t * 0.7) * 0.32;

      targetCamPos = [
        smoothAgentPosRef.current.x + bx * droneDist + hoverX,
        droneHeight + hoverY,
        smoothAgentPosRef.current.z + bz * droneDist + hoverZ
      ];
      targetLookAt = [
        smoothAgentPosRef.current.x,
        0.0,
        smoothAgentPosRef.current.z
      ];

      // Beautiful slow, heavy aerodynamic flight drag (lag)
      camera.position.lerp(new THREE.Vector3(...targetCamPos), Math.min(delta * 1.8, 1.0));
    }

    if (targetLookAt) {
      const tLook = new THREE.Vector3(...targetLookAt);
      if (!currentLookAtRef.current) {
        currentLookAtRef.current = tLook.clone();
      } else {
        currentLookAtRef.current.lerp(tLook, Math.min(delta * 11.0, 1.0)); // Smooth lookAt transition
      }
      camera.lookAt(currentLookAtRef.current);
    }
  });

  return null;
};

// ─── MAIN 3D SIMULATOR COMPONENT ───

export default function Simulation3D({ size, baseGrid, agentPos, goalPos, waypoints = [], currentWaypointIndex = 0, trafficLights = [], lightsGreen = false, dynamicObstacles, lastAction, simSpeed = 450, theme = 'city', raceMode = false, racer1Pos = null, racer2Pos = null, racer1LastAction = null, racer2LastAction = null, racer1Model = '', racer2Model = '', racerPositions = null, racerLastActions = null, racerModels = null }) {
  const [cameraMode, setCameraMode] = useState('orbit');
  const halfGrid = size / 2;
  const smoothCarPosRef = useRef(new THREE.Vector3());

  const to3DCoords = (row, col, height = 0.0) => {
    return [
      col - halfGrid + 0.5,
      height,
      row - halfGrid + 0.5
    ];
  };

  // Capture initial starting position of the episode dynamically
  const startPos3D = useMemo(() => {
    if (agentPos) {
      return to3DCoords(agentPos.row, agentPos.col, 0.0);
    }
    return null;
  }, [goalPos]); // Re-evaluate only when goalPos changes (triggers on episode start!)

  const asphaltTexture = useMemo(() => createAsphaltTexture(), []);
  const grassTexture = useMemo(() => createGrassTexture(), []);
  const concreteTexture = useMemo(() => createConcreteTexture(), []);
  const marsSandTexture = useMemo(() => createMartianSandTexture(), []);
  const sterileTilesTexture = useMemo(() => createSterileTilesTexture(), []);

  // 8-Directional LiDAR Calculation
  const calculatedRays = useMemo(() => {
    if (!agentPos) return [];

    const dirs = [
      { r: 0, c: -1 }, // SOL
      { r: 1, c: -1 }, // SOL-AŞAĞI
      { r: 1, c: 0 }, // AŞAĞI
      { r: 1, c: 1 }, // SAĞ-AŞAĞI
      { r: 0, c: 1 }, // SAĞ
      { r: -1, c: 1 }, // SAĞ-YUKARI
      { r: -1, c: 0 }, // YUKARI
      { r: -1, c: -1 }  // SOL-YUKARI
    ];

    return dirs.map(dir => {
      let currR = agentPos.row;
      let currC = agentPos.col;
      let hit = false;
      let steps = 0;
      const maxSteps = 7;

      while (steps < maxSteps) {
        currR += dir.r;
        currC += dir.c;
        steps++;

        if (currR < 0 || currR >= size || currC < 0 || currC >= size) {
          hit = true;
          currR = Math.max(0, Math.min(size - 1, currR));
          currC = Math.max(0, Math.min(size - 1, currC));
          break;
        }

        if (baseGrid[currR]?.[currC] === 'obstacle') {
          hit = true;
          break;
        }

        const isDyn = dynamicObstacles.some(o => o.row === currR && o.col === currC);
        if (isDyn) {
          hit = true;
          break;
        }
      }

      const endCoords = to3DCoords(currR, currC, 0.0);
      return {
        x: endCoords[0],
        z: endCoords[2],
        hitObstacle: hit
      };
    });
  }, [agentPos, size, baseGrid, dynamicObstacles]);

  // Static Obstacles list
  const staticObstacles = useMemo(() => {
    const list = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (baseGrid[r]?.[c] === 'obstacle') {
          list.push({ r, c, id: `${r}-${c}`, seed: r * 13 + c * 7 });
        }
      }
    }
    return list;
  }, [baseGrid, size]);

  // Beautiful Scattered Trees/Pallets on the sidewalks and surrounding grass fields
  const treePositions = useMemo(() => {
    const list = [];

    // 1. Scattered pine trees on the green grass outside the city pavement grid
    const countOnGrass = 28;
    const radiusStart = size / 2 + 1.2;
    for (let i = 0; i < countOnGrass; i++) {
      const angle = (i / countOnGrass) * Math.PI * 2 + (i % 3) * 0.15;
      const dist = radiusStart + 1.0 + (i % 4) * 2.0;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      list.push({
        id: `tree-g-${i}`,
        pos: [x, 0, z],
        scale: 0.8 + (i % 4) * 0.12 // diverse tree heights
      });
    }

    // 2. Sidewalk trees along the outer concrete boundaries of the town grid (safe zones)
    for (let i = -halfGrid + 1.5; i < halfGrid; i += 3) {
      // North sidewalk boundary
      list.push({ id: `tree-s-n-${i}`, pos: [i, 0, -halfGrid - 0.25], scale: 0.75 + (i % 2) * 0.1 });
      // South sidewalk boundary
      list.push({ id: `tree-s-s-${i}`, pos: [i, 0, halfGrid + 0.25], scale: 0.75 + (i % 2) * 0.1 });
      // West sidewalk boundary
      list.push({ id: `tree-s-w-${i}`, pos: [-halfGrid - 0.25, 0, i], scale: 0.75 + (i % 2) * 0.1 });
      // East sidewalk boundary
      list.push({ id: `tree-s-e-${i}`, pos: [halfGrid + 0.25, 0, i], scale: 0.75 + (i % 2) * 0.1 });
    }

    return list;
  }, [size, halfGrid]);

  const agent3DPos = useMemo(() => {
    return agentPos ? to3DCoords(agentPos.row, agentPos.col, 0.01) : null;
  }, [agentPos, size]);

  const racer1Pos3D = useMemo(() => {
    return racer1Pos ? to3DCoords(racer1Pos.row, racer1Pos.col, 0.012) : null;
  }, [racer1Pos, size]);

  const racer2Pos3D = useMemo(() => {
    return racer2Pos ? to3DCoords(racer2Pos.row, racer2Pos.col, 0.012) : null;
  }, [racer2Pos, size]);

  const activeRacers = useMemo(() => {
    const list = [];
    const positions = racerPositions || [racer1Pos, racer2Pos, null, null, null];
    const models = racerModels || [racer1Model, racer2Model, '', '', ''];
    const actions = racerLastActions || [racer1LastAction, racer2LastAction, null, null, null];

    for (let i = 0; i < 5; i++) {
      const pos = positions[i];
      if (pos && pos.row !== undefined && pos.col !== undefined) {
        let m = models[i] || '';
        if (!m || m.trim() === '') {
          m = `racer${i + 1}`;
        }
        list.push({
          pos,
          model: m,
          lastAction: actions[i] || null,
          id: i
        });
      }
    }
    return list;
  }, [racerPositions, racerModels, racerLastActions, racer1Pos, racer2Pos, racer1Model, racer2Model, racer1LastAction, racer2LastAction]);

  const activeRacers3D = useMemo(() => {
    return activeRacers.map(r => ({
      ...r,
      pos3D: to3DCoords(r.pos.row, r.pos.col, 0.012 + r.id * 0.001)
    }));
  }, [activeRacers, size]);

  const goal3DPos = useMemo(() => {
    return goalPos ? to3DCoords(goalPos.row, goalPos.col, 0.0) : null;
  }, [goalPos, size]);

  const remainingWaypoints3D = useMemo(() => {
    return waypoints.slice(currentWaypointIndex).map((w, idx) => ({
      id: `wp-${idx}-${w.row}-${w.col}`,
      pos: to3DCoords(w.row, w.col, 0.0)
    }));
  }, [waypoints, currentWaypointIndex, size]);

  const trafficLights3D = useMemo(() => {
    return trafficLights.map((t, idx) => ({
      id: `tl-${idx}-${t.row}-${t.col}`,
      pos: to3DCoords(t.row, t.col, 0.0)
    }));
  }, [trafficLights, size]);

  const dynObstacles3D = useMemo(() => {
    return dynamicObstacles.map(o => ({
      id: o.id,
      pos: to3DCoords(o.row, o.col, 0.01)
    }));
  }, [dynamicObstacles, size]);

  const twinPanelTitles = {
    city: '🏡 TOWN SIMULATOR (UNITY 3D ENGINE STYLE)',
    warehouse: '📦 WAREHOUSE TWIN SIMULATOR (INDUSTRY 4.0)',
    mars: '🚀 MARTIAN TERRAIN EXPLORATION DRIVE',
    hospital: '🏥 MEDICAL CLINICAL LOGISTICS VIRTUAL TWIN'
  };

  const twinPanelStatus = {
    city: 'ENGINE STATUS: ACTIVE · REAL SHADOWS: ON · 60 FPS SOLID',
    warehouse: 'AGVS ROUTING: CALIBRATED · SAFETY BEACONS: ACTIVE · 60 FPS',
    mars: 'ROVER TELEMETRY: LINKED · WEATHER SYSTEM: CALIBRATED · 60 FPS',
    hospital: 'DISINFECTION SHIELD: ENGAGED · HYGIENE LEVEL: 100% · 60 FPS'
  };

  return (
    <div style={{ width: '100%', height: '620px', borderRadius: '24px', overflow: 'hidden', border: '1px solid #4a5568', position: 'relative', boxShadow: '0 20px 45px rgba(0,0,0,0.5)', background: '#1a202c' }}>

      {/* ── CAMERA VIEW CONTROLLER ── */}
      <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 10, display: 'flex', gap: '6px', background: 'rgba(26, 32, 44, 0.9)', padding: '5px', borderRadius: '10px', border: '1px solid #4a5568', backdropFilter: 'blur(8px)' }}>
        <button
          onClick={() => setCameraMode('orbit')}
          style={{
            background: cameraMode === 'orbit' ? '#3182ce' : 'transparent',
            color: '#fff',
            border: 'none',
            padding: '7px 14px',
            fontSize: '11px',
            fontWeight: 'bold',
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontFamily: 'monospace'
          }}
        >
          🎥 SERBEST KAMERA
        </button>
        <button
          onClick={() => setCameraMode('tps')}
          style={{
            background: cameraMode === 'tps' ? '#3182ce' : 'transparent',
            color: '#fff',
            border: 'none',
            padding: '7px 14px',
            fontSize: '11px',
            fontWeight: 'bold',
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontFamily: 'monospace'
          }}
        >
          🚗 TPS TAKİP
        </button>
        <button
          onClick={() => setCameraMode('fps')}
          style={{
            background: cameraMode === 'fps' ? '#3182ce' : 'transparent',
            color: '#fff',
            border: 'none',
            padding: '7px 14px',
            fontSize: '11px',
            fontWeight: 'bold',
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontFamily: 'monospace'
          }}
        >
          👁️ SÜRÜCÜ GÖZÜ (FPS)
        </button>
        <button
          onClick={() => setCameraMode('drone')}
          style={{
            background: cameraMode === 'drone' ? '#3182ce' : 'transparent',
            color: '#fff',
            border: 'none',
            padding: '7px 14px',
            fontSize: '11px',
            fontWeight: 'bold',
            borderRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontFamily: 'monospace'
          }}
        >
          🛸 DRONE KAMERA
        </button>
      </div>

      {/* R3F Canvas - High realism, highly optimized, SHADOWS ENABLED for only 1 directional light! */}
      <Canvas shadows camera={{ position: [0, size * 0.8, size * 0.8], fov: 42 }}>
        <Suspense fallback={null}>

        {/* Beautiful Natural Sky or Martian sky or clinical interior dome */}
        {theme === 'mars' ? (
          <Sky
            distance={450000}
            sunPosition={[20, 8, 25]}
            turbidity={18}
            rayleigh={2.5}
            mieCoefficient={0.015}
            mieDirectionalG={0.6}
          />
        ) : (
          <Sky
            distance={450000}
            sunPosition={[25, 12, 20]}
            turbidity={theme === 'hospital' ? 2 : 6}
            rayleigh={theme === 'hospital' ? 0.4 : 1.2}
            mieCoefficient={theme === 'hospital' ? 0.002 : 0.005}
            mieDirectionalG={0.8}
          />
        )}

        {/* Soft natural golden hour atmospheric fog (Pushed far away to prevent whitening on zoom out!) */}
        <fog
          attach="fog"
          args={[
            theme === 'mars' ? '#9c4221' :
            theme === 'hospital' ? '#edf2f7' :
            theme === 'warehouse' ? '#2d3748' :
            '#e2e8f0',
            50.0,
            150.0
          ]}
        />

        {/* Warm Ambient fill light */}
        <ambientLight intensity={theme === 'hospital' ? 0.95 : 0.7} color={theme === 'mars' ? '#ff9f1c' : '#fffcf0'} />

        {/* Primary Warm Sunlight (The shadow-casting light) */}
        <directionalLight
          castShadow
          position={[25, 12, 20]}
          intensity={theme === 'hospital' ? 1.0 : 1.4}
          color={theme === 'mars' ? '#ff7a00' : (theme === 'hospital' ? '#ffffff' : '#ffd8a8')}
          shadow-mapSize={[1024, 1024]}
          shadow-camera-far={100}
          shadow-camera-left={-size}
          shadow-camera-right={size}
          shadow-camera-top={size}
          shadow-camera-bottom={-size}
        />

        {/* Dynamic floating air sparks / dusty Martian sandstorm particles */}
        <FloatingDustParticles theme={theme} />

        {/* Outer Grass Field / Concrete / Martian Soil Terrain (Receive Shadow) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
          <planeGeometry args={[800, 800]} />
          <meshStandardMaterial
            map={
              theme === 'warehouse' ? concreteTexture :
              theme === 'mars' ? marsSandTexture :
              theme === 'hospital' ? sterileTilesTexture :
              grassTexture
            }
            map-repeat={theme === 'mars' ? [16, 16] : [24, 24]}
            roughness={theme === 'hospital' ? 0.1 : 0.9}
            metalness={theme === 'warehouse' ? 0.2 : 0.0}
          />
        </mesh>

        {/* Outer Ring Road (Realistic dark concrete highway - only for city) */}
        {theme === 'city' && (
          <group>
            {[-size / 2 - 4.5, size / 2 + 4.5].map((xVal, idx) => (
              <mesh key={`h-v-${idx}`} rotation={[-Math.PI / 2, 0, 0]} position={[xVal, 0.005, 0]} receiveShadow>
                <planeGeometry args={[1.5, 90]} />
                <meshStandardMaterial map={asphaltTexture} map-repeat={[1, 10]} roughness={0.7} />
              </mesh>
            ))}
            {[-size / 2 - 4.5, size / 2 + 4.5].map((zVal, idx) => (
              <mesh key={`h-h-${idx}`} rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, 0.005, zVal]} receiveShadow>
                <planeGeometry args={[1.5, 90]} />
                <meshStandardMaterial map={asphaltTexture} map-repeat={[1, 10]} roughness={0.7} />
              </mesh>
            ))}

            {/* Highway Traffic */}
            <BackgroundHighwayTraffic size={size} />
          </group>
        )}

        {/* Main Test Arena Surface */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow>
          <planeGeometry args={[size + 0.1, size + 0.1]} />
          <meshStandardMaterial
            map={
              theme === 'warehouse' ? concreteTexture :
              theme === 'mars' ? marsSandTexture :
              theme === 'hospital' ? sterileTilesTexture :
              asphaltTexture
            }
            map-repeat={theme === 'mars' ? [3, 3] : [size / 2, size / 2]}
            roughness={theme === 'hospital' ? 0.05 : 0.75}
            metalness={theme === 'warehouse' ? 0.35 : 0.1}
          />
        </mesh>

        {/* Realistic Concrete Sidewalk Borders (Çevre Bordür Taşları ve Kaldırım) */}
        {theme !== 'mars' && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} receiveShadow>
            <ringGeometry args={[size / 2, size / 2 + 0.12, 4]} />
            <meshStandardMaterial color={theme === 'mars' ? '#c05621' : '#a0aec0'} roughness={0.8} />
          </mesh>
        )}

        {/* Road Lane Markings (White dashed outer edge borders) */}
        {theme !== 'mars' && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]}>
            <ringGeometry args={[size / 2 - 0.03, size / 2, 4]} />
            <meshBasicMaterial color={theme === 'warehouse' ? '#d69e2e' : '#ffffff'} transparent opacity={0.6} />
          </mesh>
        )}

        {/* Grid Road Lane Dividers (Dashed Yellow/White Highway lines / Holographic Telemetry grids) */}
        {theme !== 'mars' && (() => {
          const gridParams = {
            warehouse: { color: '#ecc94b', width: 0.018, opacity: 0.4, blending: THREE.NormalBlending },
            hospital: { color: '#4fd1c5', width: 0.010, opacity: 0.3, blending: THREE.NormalBlending },
            city: { color: '#ffffff', width: 0.012, opacity: 0.22, blending: THREE.NormalBlending }
          }[theme] ?? { color: '#ffffff', width: 0.012, opacity: 0.22, blending: THREE.NormalBlending };

          return Array.from({ length: size + 1 }).map((_, i) => {
            const linePos = i - halfGrid; // Exact integer boundary lines separating cells
            return (
              <group key={i}>
                {/* Horizontal grid lines */}
                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, linePos]}>
                  <planeGeometry args={[size, gridParams.width]} />
                  <meshBasicMaterial color={gridParams.color} opacity={gridParams.opacity} transparent blending={gridParams.blending} />
                </mesh>
                {/* Vertical grid lines */}
                <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[linePos, 0.004, 0]}>
                  <planeGeometry args={[size, gridParams.width]} />
                  <meshBasicMaterial color={gridParams.color} opacity={gridParams.opacity} transparent blending={gridParams.blending} />
                </mesh>
              </group>
            );
          });
        })()}

        {/* Indoor wall shell enclosing the facility and ceiling trusses */}
        {(theme === 'warehouse' || theme === 'hospital') && (
          <IndoorShell3D size={size} theme={theme} />
        )}

        {/* Beautiful Scattered Pine Trees / Craters / Space rocks (Only for city and mars outdoor layouts) */}
        {(theme === 'city' || theme === 'mars') && treePositions.map(t => (
          <Tree3D key={t.id} position={t.pos} scale={t.scale} theme={theme} />
        ))}

        {/* Static Obstacles (Brick houses / Pallet shelves / Martian pods / Med scanners) */}
        {staticObstacles.map(obs => (
          <CityBuilding3D key={obs.id} position={to3DCoords(obs.r, obs.c, 0.0)} seed={obs.seed} theme={theme} />
        ))}

        {/* Dynamic Goal Target beacon */}
        {goal3DPos && <Goal3D position={goal3DPos} theme={theme} />}

        {/* Dynamic Starting Point Laser Beacon */}
        {startPos3D && <StartPoint3D position={startPos3D} theme={theme} />}

        {/* Dynamic Checkpoint Waypoints */}
        {remainingWaypoints3D.map(w => (
          <Waypoint3D key={w.id} position={w.pos} theme={theme} />
        ))}

        {/* Cozy City Streetlights (Warm glowing poles casting soft light onto the asphalt) */}
        {theme !== 'mars' && [
          [-size / 4, -size / 4],
          [size / 4, -size / 4],
          [-size / 4, size / 4],
          [size / 4, size / 4]
        ].map(([x, z], idx) => (
          <StreetLight3D key={`light-${idx}`} position={[x, 0.0, z]} theme={theme} />
        ))}

        {/* Realistic Traffic Lights */}
        {theme !== 'mars' && trafficLights3D.map(t => (
          <TrafficLight3D key={t.id} position={t.pos} isGreen={lightsGreen} theme={theme} />
        ))}

        {/* Agent (Self-driving supercar or industrial AMR or Martian Rover or Medical Capsule) */}
        {raceMode ? (
          activeRacers3D.map(r => {
            const colors = ["#22d3ee", "#fb923c", "#eab308", "#10b981", "#a855f7"];
            const labels = ["🔵 1", "🟠 2", "🟡 3", "🟢 4", "🟣 5"];
            const color = colors[r.id % colors.length];
            const label = labels[r.id % labels.length];
            return (
              <Agent3D 
                key={r.id}
                position={r.pos3D} 
                lastAction={r.lastAction} 
                simSpeed={simSpeed} 
                theme={theme} 
                carColor={color} 
                racerLabel={`${label}: ${r.model.toUpperCase()}`}
              />
            );
          })
        ) : (
          agent3DPos && (
            <Agent3D position={agent3DPos} lastAction={lastAction} smoothCarPosRef={smoothCarPosRef} simSpeed={simSpeed} theme={theme} />
          )
        )}

        {/* Red sports cars / forklift / dust devil / medical staffs (Dynamic Obstacles) */}
        {dynObstacles3D.map(o => (
          <CityCarObstacle3D key={o.id} position={o.pos} theme={theme} />
        ))}

        {/* LiDAR Lazeri Işınları */}
        {!raceMode && agent3DPos && <LiDARBeams agentPos={agent3DPos} calculatedRays={calculatedRays} />}

        {/* Dynamic Camera Controllers */}
        <CameraController 
          cameraMode={cameraMode} 
          agent3DPos={agent3DPos} 
          lastAction={lastAction} 
          smoothCarPosRef={smoothCarPosRef} 
          raceMode={raceMode}
          racer1Pos3D={racer1Pos3D}
          racer2Pos3D={racer2Pos3D}
          activeRacers3D={activeRacers3D}
        />

        {/* Orbit Controls (Only active in free orbit mode) */}
        <OrbitControls
          enabled={cameraMode === 'orbit'}
          enableDamping
          dampingFactor={0.08}
          maxPolarAngle={Math.PI / 2 - 0.06}
          minDistance={2.0}
          maxDistance={size * 1.5}
        />

        </Suspense>
      </Canvas>

      {/* Dynamic Twin Info Panel Card */}
      <div style={{ position: 'absolute', bottom: '20px', left: '20px', color: '#fff', fontSize: '11px', background: 'rgba(26, 32, 44, 0.95)', padding: '15px 20px', borderRadius: '14px', border: '1px solid #4a5568', pointerEvents: 'none', fontFamily: 'monospace', backdropFilter: 'blur(8px)', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', lineHeight: '1.6' }}>
        <div style={{ color: '#c084fc', fontWeight: 'bold', marginBottom: '6px', fontSize: '13px', letterSpacing: '0.5px' }}>
          {twinPanelTitles[theme] ?? twinPanelTitles.city}
        </div>
        <div>• SOL TIK + SÜRÜKLE: Kamerayı Serbest Döndür</div>
        <div>• MAUSE TEKERLEĞİ: Yakınlaşma / Uzaklaşma Kontrolü</div>
        <div>• SAĞ ÜST PANEL: Kamera Açıları Arası Geçiş Yap</div>
        <div style={{ color: '#48bb78', marginTop: '6px', fontWeight: 'bold' }}>
          {twinPanelStatus[theme] ?? twinPanelStatus.city}
        </div>
      </div>
    </div>
  );
}
