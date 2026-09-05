'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Line, OrbitControls, Text } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { type Vec2, v2 } from '@/lib/geometry/vec';
import { containWithinRoom, snapPlacement, type SnapGuide } from '@/lib/layout/snap';
import type { InventoryItem, Layout, Room, RoomFeature } from '@/lib/domain/types';
import type { Evaluation } from '@/lib/constraints/evaluate';
import { formatLength } from '@/lib/format';
import { useStudio } from '@/lib/store/studio';
import { Furniture } from './Furniture';
import { RoomShell } from './RoomShell';
import { ClearanceOverlay, Dimensions, DoorSwings, FindingPins, SunOverlay } from './Overlays3D';

interface SceneProps {
  room: Room;
  features: RoomFeature[];
  evaluation: Evaluation;
  ghostLayout: Layout | null;
  inventory: Map<string, InventoryItem>;
  /** Drop heat maps, pins and problem outlines so the room can be read as a room. */
  quiet?: boolean;
}

function DraggablePiece({
  resolved,
  selected,
  hovered,
  hasProblem,
  dragging,
  onPointerDown,
  onHover,
  register,
}: {
  resolved: Evaluation['resolved'][number];
  selected: boolean;
  hovered: boolean;
  hasProblem: boolean;
  dragging: boolean;
  onPointerDown: (e: ThreeEvent<PointerEvent>, itemId: string) => void;
  onHover: (id: string | null) => void;
  register: (itemId: string, group: THREE.Group | null) => void;
}) {
  const { item, size, baseY } = resolved;
  const placed = useStudio(
    (s) => s.layoutItems.find((i) => i.itemId === resolved.id) ?? resolved.placed,
  );
  const groupRef = useRef<THREE.Group>(null);
  const outlineColor = hasProblem ? '#d9695f' : selected ? '#dcb066' : '#8d99ab';

  // Drive pose from the store only when this piece is not mid-drag. While the
  // pointer is down the scene writes the group directly, so React must not
  // snap it back to a stale evaluation.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group || dragging) return;
    group.position.set(placed.position.x, baseY, placed.position.y);
    group.rotation.set(0, -placed.rotation, 0);
  }, [baseY, dragging, placed.position.x, placed.position.y, placed.rotation]);

  useEffect(() => {
    register(item.id, groupRef.current);
    return () => register(item.id, null);
  }, [item.id, register]);

  return (
    <group
      ref={groupRef}
      onPointerDown={(e) => onPointerDown(e, item.id)}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(item.id);
      }}
      onPointerOut={() => onHover(null)}
    >
      <Furniture
        category={item.category}
        width={size.x}
        height={size.y}
        depth={size.z}
        color={item.color}
        selected={selected}
      />

      {(selected || hovered || hasProblem) && (
        <Line
          points={[
            new THREE.Vector3(-size.x / 2, 0.006, -size.z / 2),
            new THREE.Vector3(size.x / 2, 0.006, -size.z / 2),
            new THREE.Vector3(size.x / 2, 0.006, size.z / 2),
            new THREE.Vector3(-size.x / 2, 0.006, size.z / 2),
            new THREE.Vector3(-size.x / 2, 0.006, -size.z / 2),
          ]}
          color={outlineColor}
          lineWidth={selected ? 2.2 : 1.3}
          transparent
          opacity={selected ? 1 : 0.6}
        />
      )}

      {selected && (
        <>
          {/* Facing indicator: the front of every piece is local +Z. */}
          <Line
            points={[
              new THREE.Vector3(0, 0.01, size.z / 2),
              new THREE.Vector3(0, 0.01, size.z / 2 + 0.34),
            ]}
            color="#dcb066"
            lineWidth={1.6}
          />
          <mesh position={[0, 0.011, size.z / 2 + 0.4]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.055, 3]} />
            <meshBasicMaterial color="#dcb066" />
          </mesh>
        </>
      )}

      {placed.locked && (
        <Text
          position={[0, size.y + 0.14, 0]}
          fontSize={0.14}
          color="#8d99ab"
          anchorX="center"
          anchorY="middle"
        >
          locked
        </Text>
      )}
    </group>
  );
}

function GhostLayer({
  layout,
  inventory,
}: {
  layout: Layout;
  inventory: Map<string, InventoryItem>;
}) {
  return (
    <group>
      {layout.items.map((placed) => {
        const item = inventory.get(placed.itemId);
        if (!item) return null;
        const s = placed.scale || 1;
        return (
          <group
            key={placed.itemId}
            position={[placed.position.x, placed.elevation, placed.position.y]}
            rotation={[0, -placed.rotation, 0]}
          >
            <Furniture
              category={item.category}
              width={item.size.x * s}
              height={item.size.y * s}
              depth={item.size.z * s}
              color={item.color}
              faded
            />
          </group>
        );
      })}
    </group>
  );
}

function Guides({ guides }: { guides: SnapGuide[] }) {
  return (
    <group>
      {guides.map((g, i) => (
        <Line
          key={i}
          points={[new THREE.Vector3(g.a.x, 0.026, g.a.y), new THREE.Vector3(g.b.x, 0.026, g.b.y)]}
          color={g.kind === 'wall' ? '#6bb6a1' : '#dcb066'}
          lineWidth={1.4}
          dashed={g.kind !== 'wall'}
          dashSize={0.1}
          gapSize={0.06}
          transparent
          opacity={0.85}
        />
      ))}
    </group>
  );
}

function roomCentre(room: Room) {
  const xs = room.footprint.map((p) => p.x);
  const ys = room.footprint.map((p) => p.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    span: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
  };
}

function CameraRig({
  room,
  target,
  controls,
  quiet,
}: {
  room: Room;
  target: THREE.Vector3;
  controls: React.RefObject<OrbitControlsImpl | null>;
  quiet?: boolean;
}) {
  const { camera } = useThree();
  const framed = useRef<string | null>(null);

  // Frame the room once per room, then leave the camera to WASD and orbit.
  useEffect(() => {
    if (framed.current === room.id) return;
    framed.current = room.id;
    const centre = roomCentre(room);
    if (quiet) {
      camera.position.set(centre.x, centre.span * 1.45, centre.y + centre.span * 0.72);
      target.set(centre.x, 0.15, centre.y);
    } else {
      camera.position.set(centre.x - centre.span * 0.55, centre.span * 1.05, centre.y + centre.span * 1.15);
      target.set(centre.x, 0.7, centre.y);
    }
    camera.lookAt(target);
    controls.current?.target.copy(target);
  }, [camera, controls, quiet, room, target]);

  return null;
}

/**
 * Walk the camera on the floor plane, the way a game does, instead of click-dragging
 * to pan. Heading follows the current look direction so W is always "into the room
 * as I see it". Q/E raise and lower the viewpoint without changing that heading.
 */
function WalkControls({
  enabled,
  controls,
  target,
}: {
  enabled: boolean;
  controls: React.RefObject<OrbitControlsImpl | null>;
  target: THREE.Vector3;
}) {
  const { camera } = useThree();
  const held = useRef({
    w: false,
    a: false,
    s: false,
    d: false,
    q: false,
    e: false,
    shift: false,
  });
  const forward = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const delta = useMemo(() => new THREE.Vector3(), []);
  const worldUp = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useEffect(() => {
    const typing = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      return /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable;
    };

    const setKey = (e: KeyboardEvent, down: boolean) => {
      if (typing(e.target)) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      switch (k) {
        case 'w':
        case 'a':
        case 's':
        case 'd':
        case 'q':
        case 'e':
          e.preventDefault();
          held.current[k] = down;
          break;
        case 'Shift':
          held.current.shift = down;
          break;
        default:
          break;
      }
    };

    const onDown = (e: KeyboardEvent) => setKey(e, true);
    const onUp = (e: KeyboardEvent) => setKey(e, false);
    const onBlur = () => {
      held.current = { w: false, a: false, s: false, d: false, q: false, e: false, shift: false };
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useFrame((_, dt) => {
    if (!enabled) return;
    const k = held.current;
    if (!(k.w || k.a || k.s || k.d || k.q || k.e)) return;

    const orbit = controls.current;
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) {
      // Straight down: W should still mean "the way the camera is facing on the plan".
      const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
      forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    } else {
      forward.normalize();
    }
    right.crossVectors(forward, worldUp).normalize();

    delta.set(0, 0, 0);
    if (k.w) delta.add(forward);
    if (k.s) delta.sub(forward);
    if (k.d) delta.add(right);
    if (k.a) delta.sub(right);
    const speed = (k.shift ? 9 : 3.6) * Math.min(dt, 0.05);
    if (delta.lengthSq() > 0) delta.normalize().multiplyScalar(speed);

    let dy = 0;
    if (k.e) dy += speed;
    if (k.q) dy -= speed;

    camera.position.add(delta);
    camera.position.y = THREE.MathUtils.clamp(camera.position.y + dy, 0.35, 14);
    target.add(delta);
    target.y = THREE.MathUtils.clamp(target.y + dy, 0.05, 12);
    if (orbit) {
      orbit.target.copy(target);
      orbit.update();
    }
  });

  return null;
}

function SceneContents({ room, features, evaluation, ghostLayout, inventory, quiet }: SceneProps) {
  const { camera, gl, invalidate } = useThree();
  const overlays = useStudio((s) => s.overlays);
  const selection = useStudio((s) => s.selection);
  const hovered = useStudio((s) => s.hovered);
  const snapEnabled = useStudio((s) => s.snapEnabled);
  const gridSnapM = useStudio((s) => s.gridSnapM);
  const snapAngleDeg = useStudio((s) => s.snapAngleDeg);
  const project = useStudio((s) => s.project);
  const moveItem = useStudio((s) => s.moveItem);
  const rotateItem = useStudio((s) => s.rotateItem);
  const toggleSelection = useStudio((s) => s.toggleSelection);
  const setHovered = useStudio((s) => s.setHovered);
  const setSelection = useStudio((s) => s.setSelection);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const controls = useRef<OrbitControlsImpl>(null);
  const orbitTarget = useMemo(() => new THREE.Vector3(), []);
  const groups = useRef(new Map<string, THREE.Group>());
  const drag = useRef<{
    itemId: string;
    grab: Vec2;
    size: Vec2;
    rotation: number;
    baseY: number;
    live: Vec2;
  } | null>(null);
  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const dragRaycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);

  const problemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const f of evaluation.findings) {
      if (f.severity === 'note') continue;
      f.itemIds.forEach((id) => ids.add(id));
    }
    return ids;
  }, [evaluation.findings]);

  const registerGroup = useCallback((itemId: string, group: THREE.Group | null) => {
    if (group) groups.current.set(itemId, group);
    else groups.current.delete(itemId);
  }, []);

  const pointerOnFloor = useCallback(
    (clientX: number, clientY: number): Vec2 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      dragRaycaster.setFromCamera(ndc, camera);
      if (!dragRaycaster.ray.intersectPlane(floorPlane, hit)) return null;
      return v2(hit.x, hit.z);
    },
    [camera, dragRaycaster, floorPlane, gl, hit, ndc],
  );

  const poseGroup = (itemId: string, position: Vec2, baseY: number, rotation: number) => {
    const group = groups.current.get(itemId);
    if (!group) return;
    group.position.set(position.x, baseY, position.y);
    group.rotation.set(0, -rotation, 0);
  };

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>, itemId: string) => {
      e.stopPropagation();
      toggleSelection(itemId, e.nativeEvent.shiftKey);
      const resolved = evaluation.resolved.find((r) => r.id === itemId);
      if (!resolved || resolved.placed.locked) return;
      const floor = pointerOnFloor(e.nativeEvent.clientX, e.nativeEvent.clientY) ?? v2(e.point.x, e.point.z);
      drag.current = {
        itemId,
        grab: v2(floor.x - resolved.placed.position.x, floor.y - resolved.placed.position.y),
        size: v2(resolved.size.x, resolved.size.z),
        rotation: resolved.placed.rotation,
        baseY: resolved.baseY,
        live: v2(resolved.placed.position.x, resolved.placed.position.y),
      };
      if (controls.current) controls.current.enabled = false;
      setDraggingId(itemId);
      gl.domElement.style.cursor = 'grabbing';
    },
    [evaluation.resolved, gl, pointerOnFloor, toggleSelection],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const session = drag.current;
      if (!session) return;
      const floor = pointerOnFloor(e.clientX, e.clientY);
      if (!floor) return;
      const raw = v2(floor.x - session.grab.x, floor.y - session.grab.y);
      const contained = containWithinRoom(raw, session.size, session.rotation, room.footprint);
      session.live = contained;
      poseGroup(session.itemId, contained, session.baseY, session.rotation);
      invalidate();
    };

    const onUp = (e: PointerEvent) => {
      const session = drag.current;
      if (!session) return;
      const floor = pointerOnFloor(e.clientX, e.clientY);
      const raw = floor
        ? v2(floor.x - session.grab.x, floor.y - session.grab.y)
        : session.live;
      const others = evaluation.resolved
        .filter((r) => r.id !== session.itemId && !r.prior.walkable)
        .map((r) => ({ id: r.id, obb: r.obb }));
      const snapped = snapPlacement(
        { position: raw, rotation: session.rotation, size: session.size },
        {
          roomFootprint: room.footprint,
          others,
          enabled: snapEnabled && !e.shiftKey,
          gridStep: gridSnapM,
          angleStepDeg: snapAngleDeg,
        },
      );
      const contained = containWithinRoom(snapped.position, session.size, snapped.rotation, room.footprint);
      poseGroup(session.itemId, contained, session.baseY, snapped.rotation);
      drag.current = null;
      gl.domElement.style.cursor = '';
      setDraggingId(null);
      setGuides(snapped.guides);
      moveItem(session.itemId, contained);
      if (Math.abs(snapped.rotation - session.rotation) > 1e-4) {
        rotateItem(session.itemId, snapped.rotation);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [
    evaluation.resolved,
    gl,
    gridSnapM,
    invalidate,
    moveItem,
    pointerOnFloor,
    room.footprint,
    rotateItem,
    snapAngleDeg,
    snapEnabled,
  ]);

  const selectedResolved = evaluation.resolved.find((r) => r.id === selection[0]);
  const units = project?.unitSystem ?? 'metric';

  return (
    <>
      <CameraRig room={room} target={orbitTarget} controls={controls} quiet={quiet} />
      <WalkControls enabled={!draggingId} controls={controls} target={orbitTarget} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#cfe0f2', '#20262f', 0.6]} />
      <directionalLight
        position={[room.footprint[0].x - 4, 6.5, room.footprint[0].y - 3]}
        intensity={1.15}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      <Suspense fallback={null}>
        <Environment preset="apartment" environmentIntensity={0.35} />
      </Suspense>

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.002, 0]}
        onPointerDown={() => setSelection([])}
      >
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial color="#0b0d10" />
      </mesh>

      <RoomShell room={room} features={features} showGrid={!quiet && overlays.grid} />

      <ClearanceOverlay
        grid={evaluation.grid}
        reachable={evaluation.reachableMask}
        showClearance={!quiet && overlays.clearance}
        showCirculation={!quiet && overlays.circulation}
      />
      {!quiet && overlays.sunlight && <SunOverlay patches={evaluation.sunPatches} />}
      {overlays.doorSwings && <DoorSwings features={features} />}
      {overlays.ghost && ghostLayout && <GhostLayer layout={ghostLayout} inventory={inventory} />}

      {evaluation.resolved.map((r) => (
        <DraggablePiece
          key={r.id}
          resolved={r}
          selected={selection.includes(r.id)}
          hovered={hovered === r.id}
          hasProblem={!quiet && problemIds.has(r.id)}
          dragging={draggingId === r.id}
          onPointerDown={onPointerDown}
          onHover={setHovered}
          register={registerGroup}
        />
      ))}

      {!quiet && overlays.findings && <FindingPins findings={evaluation.findings} />}

      {overlays.measurements && selectedResolved && !draggingId && (
        <Dimensions
          center={selectedResolved.obb.center}
          size={selectedResolved.obb.size}
          rotation={selectedResolved.placed.rotation}
          labelWidth={formatLength(selectedResolved.size.x, units)}
          labelDepth={formatLength(selectedResolved.size.z, units)}
        />
      )}

      <Guides guides={guides} />

      <ContactShadows
        position={[0, 0.002, 0]}
        opacity={0.42}
        scale={26}
        blur={2.2}
        far={4}
        resolution={1024}
        color="#05070a"
      />

      <OrbitControls
        ref={controls}
        enabled={!draggingId}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minPolarAngle={0.05}
        maxPolarAngle={Math.PI / 2 - 0.04}
        minDistance={1.2}
        maxDistance={26}
        target={orbitTarget}
      />
    </>
  );
}

export function Scene3D(props: SceneProps) {
  return (
    <Canvas
      // Bare `shadows` asks for PCFSoft, which three now deprecates and silently
      // downgrades to PCF anyway — naming PCF outright gets the same picture
      // without a warning on every frame.
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ fov: 42, near: 0.05, far: 200 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      className="h-full w-full"
    >
      <color attach="background" args={['#0b0d10']} />
      <fog attach="fog" args={['#0b0d10', 18, 46]} />
      <SceneContents {...props} />
    </Canvas>
  );
}
