'use client';

/**
 * The room itself.
 *
 * Walls fade out as they come between the camera and the room, which gives a
 * dollhouse view from any angle without the usual trick of just deleting two
 * walls and forcing the user to orbit around them.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vec2 } from '@/lib/geometry/vec';
import type { Room, RoomFeature } from '@/lib/domain/types';

interface WallSpec {
  mid: Vec2;
  length: number;
  angle: number;
  inward: Vec2;
}

function wallsOf(footprint: Vec2[]): WallSpec[] {
  const centroid = footprint.reduce(
    (acc, p) => ({ x: acc.x + p.x / footprint.length, y: acc.y + p.y / footprint.length }),
    { x: 0, y: 0 },
  );
  const specs: WallSpec[] = [];
  for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
    const a = footprint[j];
    const b = footprint[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let inward = { x: -dy / length, y: dx / length };
    if ((centroid.x - mid.x) * inward.x + (centroid.y - mid.y) * inward.y < 0) {
      inward = { x: -inward.x, y: -inward.y };
    }
    specs.push({ mid, length, angle: Math.atan2(dy, dx), inward });
  }
  return specs;
}

function Wall({
  spec,
  height,
  features,
}: {
  spec: WallSpec;
  height: number;
  features: RoomFeature[];
}) {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const openingRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const inward = useMemo(() => new THREE.Vector3(spec.inward.x, 0, spec.inward.y), [spec.inward]);
  const toCamera = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }) => {
    if (!materialRef.current || !groupRef.current) return;
    groupRef.current.getWorldPosition(toCamera);
    toCamera.subVectors(camera.position, toCamera).normalize();
    // `inward` points into the room. If the camera lies on that side, this wall
    // is the far side of the room and should read solid; if it stands between the
    // camera and the furniture, it ghosts away.
    const dot = toCamera.dot(inward);
    const target = dot > 0.05 ? THREE.MathUtils.clamp(dot * 1.5 + 0.2, 0.25, 0.95) : 0.05;
    const opacity = materialRef.current.opacity + (target - materialRef.current.opacity) * 0.18;
    materialRef.current.opacity = opacity;
    // Openings belong to their wall: at full strength they hang in the air like
    // panes with nothing around them once the wall has gone.
    for (const opening of openingRefs.current) {
      if (opening) opening.opacity = opacity * 0.9;
    }
  });

  // Openings drawn as recessed panels rather than true CSG holes: cheaper,
  // and reads correctly at the scale anyone actually looks at this.
  const openings = features.filter((f) => {
    const rel = {
      x: f.position.x - spec.mid.x,
      y: f.position.y - spec.mid.y,
    };
    const along = -Math.sin(spec.angle) * rel.y + Math.cos(spec.angle) * rel.x;
    const perp = rel.x * spec.inward.x + rel.y * spec.inward.y;
    return Math.abs(perp) < 0.16 && Math.abs(along) < spec.length / 2 + 0.05;
  });

  const yaw = -spec.angle;

  return (
    <group
      ref={groupRef}
      position={[spec.mid.x, height / 2, spec.mid.y]}
      rotation={[0, yaw, 0]}
    >
      <mesh receiveShadow>
        <planeGeometry args={[spec.length, height]} />
        <meshStandardMaterial
          ref={materialRef}
          color="#2a313b"
          roughness={0.95}
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {openings.map((f, index) => {
        const rel = { x: f.position.x - spec.mid.x, y: f.position.y - spec.mid.y };
        const along = -Math.sin(spec.angle) * rel.y + Math.cos(spec.angle) * rel.x;
        const cy = f.sillHeight + f.height / 2 - height / 2;
        const isGlass = f.kind === 'window' || f.kind === 'sliding_door';
        return (
          <mesh key={f.id} position={[along, cy, 0.012]}>
            <planeGeometry args={[f.width, f.height]} />
            <meshStandardMaterial
              ref={(m) => {
                openingRefs.current[index] = m;
              }}
              color={isGlass ? '#9fc4dd' : '#171b21'}
              emissive={isGlass ? '#7fb0d6' : '#000000'}
              emissiveIntensity={isGlass ? 0.55 : 0}
              transparent
              opacity={isGlass ? 0.5 : 0.85}
              roughness={0.2}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function FeatureMarkers({ features }: { features: RoomFeature[] }) {
  return (
    <group>
      {features
        .filter((f) => f.kind === 'outlet' || f.kind === 'tv_jack' || f.kind === 'switch')
        .map((f) => (
          <group key={f.id} position={[f.position.x, f.sillHeight, f.position.y]}>
            <mesh rotation={[0, -f.facing + Math.PI / 2, 0]}>
              <planeGeometry args={[0.09, 0.11]} />
              <meshStandardMaterial
                color={f.kind === 'outlet' ? '#dcb066' : '#6f97c4'}
                emissive={f.kind === 'outlet' ? '#c99a48' : '#6f97c4'}
                emissiveIntensity={0.7}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        ))}
      {features
        .filter((f) => f.kind === 'radiator')
        .map((f) => (
          <mesh
            key={f.id}
            position={[
              f.position.x + Math.cos(f.facing) * 0.06,
              f.sillHeight + f.height / 2,
              f.position.y + Math.sin(f.facing) * 0.06,
            ]}
            rotation={[0, -f.facing + Math.PI / 2, 0]}
          >
            <boxGeometry args={[f.width, f.height, 0.09]} />
            <meshStandardMaterial color="#b9bfc7" roughness={0.6} metalness={0.2} />
          </mesh>
        ))}
    </group>
  );
}

export function RoomShell({
  room,
  features,
  showGrid,
}: {
  room: Room;
  features: RoomFeature[];
  showGrid: boolean;
}) {
  const walls = useMemo(() => wallsOf(room.footprint), [room.footprint]);

  const floorGeometry = useMemo(() => {
    const shape = new THREE.Shape();
    room.footprint.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y)));
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2);
    return geo;
  }, [room.footprint]);

  const bounds = useMemo(() => {
    const xs = room.footprint.map((p) => p.x);
    const ys = room.footprint.map((p) => p.y);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }, [room.footprint]);

  return (
    <group>
      <mesh geometry={floorGeometry} receiveShadow position={[0, 0, 0]}>
        <meshStandardMaterial color="#2f3640" roughness={0.94} />
      </mesh>

      {showGrid && (
        <gridHelper
          args={[
            Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) + 2,
            Math.round((Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) + 2) * 2),
            '#455060',
            '#39404c',
          ]}
          position={[(bounds.minX + bounds.maxX) / 2, 0.004, (bounds.minY + bounds.maxY) / 2]}
        />
      )}

      {walls.map((spec, i) => (
        <Wall key={i} spec={spec} height={room.ceilingHeight} features={features} />
      ))}

      <FeatureMarkers features={features} />
    </group>
  );
}
