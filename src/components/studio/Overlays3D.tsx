'use client';

/**
 * Analysis layers drawn onto the floor.
 *
 * The clearance/circulation layer is a single DataTexture generated from the
 * occupancy grid — one texture upload instead of thousands of meshes, so it
 * stays smooth while you drag.
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Line, Text } from '@react-three/drei';
import type { OccupancyGrid } from '@/lib/constraints/grid';
import type { SunPatch } from '@/lib/constraints/solar';
import type { Finding } from '@/lib/constraints/evaluate';
import { doorZone } from '@/lib/domain/scene';
import type { RoomFeature } from '@/lib/domain/types';

/**
 * Paints the occupancy grid into an RGBA buffer.
 *
 * Tight clearance reads red, generous reads green; unreachable floor is dimmed
 * towards the background so islands you cannot walk to are obvious at a glance.
 */
function paintOccupancy(
  grid: OccupancyGrid,
  reachable: Uint8Array,
  showClearance: boolean,
  showCirculation: boolean,
): Uint8Array {
  const data = new Uint8Array(grid.cols * grid.rows * 4);
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const src = r * grid.cols + c;
      // Flip vertically: texture v runs opposite to grid rows on the plane.
      const dst = ((grid.rows - 1 - r) * grid.cols + c) * 4;
      if (grid.state[src] !== 1) continue;

      const clearance = grid.clearance[src];
      const walkable = reachable[src] === 1;
      const t = Math.max(0, Math.min(1, (clearance * 2 - 0.45) / 0.95));

      let rr = 0;
      let gg = 0;
      let bb = 0;
      let aa = 0;

      if (showClearance) {
        rr = Math.round(255 * (1 - t) ** 0.8);
        gg = Math.round(190 * t ** 0.7 + 40 * (1 - t));
        bb = Math.round(90 * (1 - t) * t * 2);
        aa = 118;
      }
      if (showCirculation && !walkable) {
        rr = Math.round(rr * 0.35 + 30);
        gg = Math.round(gg * 0.35 + 34);
        bb = Math.round(bb * 0.35 + 44);
        aa = Math.max(aa, 128);
      }
      if (showCirculation && walkable && !showClearance) {
        rr = 96;
        gg = 150;
        bb = 130;
        aa = 60;
      }

      data[dst] = rr;
      data[dst + 1] = gg;
      data[dst + 2] = bb;
      data[dst + 3] = aa;
    }
  }
  return data;
}

export function ClearanceOverlay({
  grid,
  reachable,
  showClearance,
  showCirculation,
}: {
  grid: OccupancyGrid;
  reachable: Uint8Array;
  showClearance: boolean;
  showCirculation: boolean;
}) {
  // One texture upload per evaluation instead of thousands of cell meshes, which
  // is the difference between a smooth drag and a stutter.
  const texture = useMemo(() => {
    const map = new THREE.DataTexture(
      paintOccupancy(grid, reachable, showClearance, showCirculation),
      grid.cols,
      grid.rows,
      THREE.RGBAFormat,
    );
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearFilter;
    map.needsUpdate = true;
    return map;
  }, [grid, reachable, showClearance, showCirculation]);

  useEffect(() => () => texture.dispose(), [texture]);

  const width = grid.cols * grid.cell;
  const height = grid.rows * grid.cell;

  return (
    <mesh
      visible={showClearance || showCirculation}
      position={[grid.origin.x + width / 2, 0.012, grid.origin.y + height / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

export function SunOverlay({ patches }: { patches: SunPatch[] }) {
  const geometries = useMemo(
    () =>
      patches.map((p) => {
        const shape = new THREE.Shape();
        p.polygon.forEach((pt, i) => (i === 0 ? shape.moveTo(pt.x, pt.y) : shape.lineTo(pt.x, pt.y)));
        shape.closePath();
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(Math.PI / 2);
        return { geo, intensity: p.intensity, id: p.featureId };
      }),
    [patches],
  );

  useEffect(() => () => geometries.forEach((g) => g.geo.dispose()), [geometries]);

  return (
    <group>
      {geometries.map((g, i) => (
        <mesh key={`${g.id}-${i}`} geometry={g.geo} position={[0, 0.016, 0]}>
          <meshBasicMaterial
            color="#ffd89a"
            transparent
            opacity={0.14 + g.intensity * 0.34}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export function DoorSwings({ features }: { features: RoomFeature[] }) {
  const doors = features.filter(
    (f) => f.kind === 'door' || f.kind === 'sliding_door' || f.kind === 'opening',
  );
  return (
    <group>
      {doors.map((f) => {
        const poly = doorZone(f);
        const points = poly.map((p) => new THREE.Vector3(p.x, 0.02, p.y));
        points.push(points[0].clone());
        return (
          <Line
            key={f.id}
            points={points}
            color="#dcb066"
            lineWidth={1.2}
            dashed
            dashSize={0.09}
            gapSize={0.07}
            transparent
            opacity={0.75}
          />
        );
      })}
    </group>
  );
}

export function FindingPins({
  findings,
  onSelect,
}: {
  findings: Finding[];
  onSelect?: (finding: Finding) => void;
}) {
  const pinned = findings.filter((f) => f.at);
  return (
    <group>
      {pinned.map((f) => {
        const color =
          f.severity === 'blocker' ? '#d9695f' : f.severity === 'warning' ? '#d9a75f' : '#6f97c4';
        return (
          <group key={f.id} position={[f.at!.x, 0.02, f.at!.y]}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(f);
              }}
            >
              <circleGeometry args={[0.11, 20]} />
              <meshBasicMaterial color={color} transparent opacity={0.85} depthTest={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
              <ringGeometry args={[0.14, 0.16, 24]} />
              <meshBasicMaterial color={color} transparent opacity={0.4} depthTest={false} />
            </mesh>
            <Text
              position={[0, 0.002, 0]}
              rotation={[-Math.PI / 2, 0, 0]}
              fontSize={0.13}
              color="#0b0d10"
              anchorX="center"
              anchorY="middle"
              depthOffset={-1}
            >
              {f.severity === 'blocker' ? '!' : f.severity === 'warning' ? '△' : 'i'}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

/** Dimension lines around the selected footprint, plus gaps to nearby walls. */
export function Dimensions({
  center,
  size,
  rotation,
  labelWidth,
  labelDepth,
}: {
  center: { x: number; y: number };
  size: { x: number; y: number };
  rotation: number;
  labelWidth: string;
  labelDepth: string;
}) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const ax = { x: cos, y: sin };
  const ay = { x: -sin, y: cos };
  const hx = size.x / 2;
  const hy = size.y / 2;
  const off = 0.16;

  const p = (u: number, v: number) =>
    new THREE.Vector3(center.x + ax.x * u + ay.x * v, 0.03, center.y + ax.y * u + ay.y * v);

  return (
    <group>
      <Line points={[p(-hx, -hy - off), p(hx, -hy - off)]} color="#dcb066" lineWidth={1.1} />
      <Line points={[p(-hx, -hy - off - 0.05), p(-hx, -hy - off + 0.05)]} color="#dcb066" lineWidth={1.1} />
      <Line points={[p(hx, -hy - off - 0.05), p(hx, -hy - off + 0.05)]} color="#dcb066" lineWidth={1.1} />
      <Text
        position={p(0, -hy - off - 0.14)}
        rotation={[-Math.PI / 2, 0, -rotation]}
        fontSize={0.13}
        color="#ecc98f"
        anchorX="center"
        anchorY="middle"
      >
        {labelWidth}
      </Text>

      <Line points={[p(hx + off, -hy), p(hx + off, hy)]} color="#dcb066" lineWidth={1.1} />
      <Line points={[p(hx + off - 0.05, -hy), p(hx + off + 0.05, -hy)]} color="#dcb066" lineWidth={1.1} />
      <Line points={[p(hx + off - 0.05, hy), p(hx + off + 0.05, hy)]} color="#dcb066" lineWidth={1.1} />
      <Text
        position={p(hx + off + 0.14, 0)}
        rotation={[-Math.PI / 2, 0, -rotation - Math.PI / 2]}
        fontSize={0.13}
        color="#ecc98f"
        anchorX="center"
        anchorY="middle"
      >
        {labelDepth}
      </Text>
    </group>
  );
}
