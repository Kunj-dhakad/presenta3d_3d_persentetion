"use client";

import { Camera } from "lucide-react";
import { useSceneEditor } from "@/stores/scene-editor";
import { OBJECT_TYPES, type LightSpec, type SceneObject, type SceneObjectType } from "@/lib/schemas/scene";
import { ColorInput, EnumSelect, NumberInput, Row, Section, SliderInput, Toggle, Vec3Input } from "./fields";
import { Button } from "@/components/ui/button";

const SIZE_LABELS: Partial<Record<SceneObjectType, [string, string | null, string | null]>> = {
  sphere: ["Radius", null, null],
  box: ["Width", "Height", "Depth"],
  torus: ["Radius", "Tube", null],
  torusKnot: ["Radius", "Tube", null],
  plane: ["Width", "Depth", null],
  cylinder: ["Radius", "Height", null],
  cone: ["Radius", "Height", null],
  icosahedron: ["Radius", null, null],
  ring: ["Outer", "Inner", null],
  particles: ["Spread", null, null],
  starfield: ["Radius", null, null],
  terrain: ["Size", null, null],
  text: ["Font size", null, null],
};

function ObjectInspector({ o }: { o: SceneObject }) {
  const { updateObject } = useSceneEditor.getState();
  const objects = useSceneEditor((s) => s.scene?.objects ?? []);
  const set = (fn: (o: SceneObject) => void, key?: string) => updateObject(o.id, fn, key);
  const sizes = SIZE_LABELS[o.type];
  // Valid parents: groups/objects that are not this object or its descendants.
  const descendants = new Set<string>([o.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const x of objects) if (x.parentId && descendants.has(x.parentId) && !descendants.has(x.id)) {
      descendants.add(x.id);
      grew = true;
    }
  }
  const parents = [{ value: "__none", label: "(scene root)" }, ...objects.filter((x) => !descendants.has(x.id)).map((x) => ({ value: x.id, label: x.name }))];

  return (
    <>
      <Section title="Object">
        <Row label="Name">
          <input value={o.name} onChange={(e) => set((x) => void (x.name = e.target.value.slice(0, 80)), "name")} aria-label="Name" className="h-7 w-full rounded-md border border-input bg-background/60 px-2 text-xs outline-none focus:border-ring" />
        </Row>
        <Row label="Type">
          <EnumSelect label="Type" value={o.type} options={OBJECT_TYPES} onChange={(v) => set((x) => void (x.type = v))} />
        </Row>
        <Row label="Parent">
          <EnumSelect label="Parent" value={o.parentId ?? "__none"} options={parents} onChange={(v) => set((x) => void (x.parentId = v === "__none" ? null : v))} />
        </Row>
        <Row label="Visible"><Toggle label="Visible" checked={o.visible} onChange={(v) => set((x) => void (x.visible = v))} /></Row>
        <Row label="Label">
          <input value={o.label} placeholder="Annotation (optional)" onChange={(e) => set((x) => void (x.label = e.target.value.slice(0, 120)), "label")} aria-label="Label" className="h-7 w-full rounded-md border border-input bg-background/60 px-2 text-xs outline-none focus:border-ring" />
        </Row>
      </Section>
      <Section title="Transform">
        <Row label="Position"><Vec3Input label="Position" value={o.position} onChange={(v) => set((x) => void (x.position = v), "pos")} /></Row>
        <Row label="Rotation°"><Vec3Input label="Rotation" step={5} value={o.rotation.map((r) => +((r * 180) / Math.PI).toFixed(2))} onChange={(v) => set((x) => void (x.rotation = v.map((d) => (d * Math.PI) / 180)), "rot")} /></Row>
        <Row label="Scale"><Vec3Input label="Scale" value={o.scale} onChange={(v) => set((x) => void (x.scale = v.map((s) => (Math.abs(s) < 0.001 ? 0.001 : s))), "scale")} /></Row>
      </Section>
      {o.type !== "group" && (
        <Section title="Shape">
          {sizes && <Row label={sizes[0]}><NumberInput label={sizes[0]} min={0.001} max={1000} value={o.params.size} onChange={(v) => set((x) => void (x.params.size = v), "size")} /></Row>}
          {sizes?.[1] && <Row label={sizes[1]}><NumberInput label={sizes[1]} min={0} max={1000} value={o.params.size2} onChange={(v) => set((x) => void (x.params.size2 = v), "size2")} /></Row>}
          {sizes?.[2] && <Row label={sizes[2]}><NumberInput label={sizes[2]} min={0} max={1000} value={o.params.size3} onChange={(v) => set((x) => void (x.params.size3 = v), "size3")} /></Row>}
          {!["particles", "starfield", "text"].includes(o.type) && <Row label="Detail"><NumberInput label="Detail" step={1} min={0} max={256} value={o.params.detail} onChange={(v) => set((x) => void (x.params.detail = Math.round(v)), "detail")} /></Row>}
          {(o.type === "particles" || o.type === "starfield") && <Row label="Count"><NumberInput label="Count" step={100} min={0} max={20000} value={o.params.count} onChange={(v) => set((x) => void (x.params.count = Math.round(v)), "count")} /></Row>}
          {o.type === "terrain" && <Row label="Height"><NumberInput label="Height amplitude" min={0} max={200} value={o.params.amplitude} onChange={(v) => set((x) => void (x.params.amplitude = v), "amp")} /></Row>}
          {(o.type === "terrain" || o.type === "particles" || o.type === "starfield") && <Row label="Seed"><NumberInput label="Seed" step={1} value={o.params.seed} onChange={(v) => set((x) => void (x.params.seed = Math.round(v)), "seed")} /></Row>}
          {o.type === "text" && (
            <Row label="Text">
              <input value={o.params.text} onChange={(e) => set((x) => void (x.params.text = e.target.value.slice(0, 200)), "text")} aria-label="Text" className="h-7 w-full rounded-md border border-input bg-background/60 px-2 text-xs outline-none focus:border-ring" />
            </Row>
          )}
          <Row label="Shadows">
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <label className="flex items-center gap-1.5">Cast <Toggle label="Cast shadow" checked={o.castShadow} onChange={(v) => set((x) => void (x.castShadow = v))} /></label>
              <label className="flex items-center gap-1.5">Receive <Toggle label="Receive shadow" checked={o.receiveShadow} onChange={(v) => set((x) => void (x.receiveShadow = v))} /></label>
            </div>
          </Row>
        </Section>
      )}
      {o.type !== "group" && (
        <Section title="Material">
          <Row label="Type"><EnumSelect label="Material type" value={o.material.type} options={["standard", "physical", "basic", "toon", "normal"] as const} onChange={(v) => set((x) => void (x.material.type = v))} /></Row>
          <Row label="Color"><ColorInput label="Color" value={o.material.color} onChange={(v) => set((x) => void (x.material.color = v), "color")} /></Row>
          <Row label="Emissive"><ColorInput label="Emissive color" value={o.material.emissive} onChange={(v) => set((x) => void (x.material.emissive = v), "emissive")} /></Row>
          <Row label="Glow"><SliderInput label="Emissive intensity" min={0} max={10} step={0.05} value={o.material.emissiveIntensity} onChange={(v) => set((x) => void (x.material.emissiveIntensity = v), "ei")} /></Row>
          <Row label="Metalness"><SliderInput label="Metalness" min={0} max={1} step={0.01} value={o.material.metalness} onChange={(v) => set((x) => void (x.material.metalness = v), "metal")} /></Row>
          <Row label="Roughness"><SliderInput label="Roughness" min={0} max={1} step={0.01} value={o.material.roughness} onChange={(v) => set((x) => void (x.material.roughness = v), "rough")} /></Row>
          <Row label="Opacity"><SliderInput label="Opacity" min={0} max={1} step={0.01} value={o.material.opacity} onChange={(v) => set((x) => void (x.material.opacity = v), "opacity")} /></Row>
          <Row label="Wireframe"><Toggle label="Wireframe" checked={o.material.wireframe} onChange={(v) => set((x) => void (x.material.wireframe = v))} /></Row>
          <Row label="Flat shading"><Toggle label="Flat shading" checked={o.material.flatShading} onChange={(v) => set((x) => void (x.material.flatShading = v))} /></Row>
        </Section>
      )}
      <Section title="Animation">
        <Row label="Type"><EnumSelect label="Animation type" value={o.animation.type} options={["none", "spin", "orbit", "float", "pulse"] as const} onChange={(v) => set((x) => void (x.animation.type = v))} /></Row>
        {o.animation.type !== "none" && (
          <>
            <Row label="Speed"><NumberInput label="Animation speed" min={-20} max={20} value={o.animation.speed} onChange={(v) => set((x) => void (x.animation.speed = v), "aspeed")} /></Row>
            {o.animation.type === "spin" && <Row label="Axis"><EnumSelect label="Axis" value={o.animation.axis} options={["x", "y", "z"] as const} onChange={(v) => set((x) => void (x.animation.axis = v))} /></Row>}
            {o.animation.type !== "spin" && <Row label={o.animation.type === "orbit" ? "Radius" : "Amplitude"}><NumberInput label="Animation radius" min={0} max={500} value={o.animation.radius} onChange={(v) => set((x) => void (x.animation.radius = v), "aradius")} /></Row>}
            <Row label="Phase"><NumberInput label="Phase" value={o.animation.phase} onChange={(v) => set((x) => void (x.animation.phase = v), "phase")} /></Row>
          </>
        )}
      </Section>
      <Section title="Interaction">
        <Row label="On interact"><EnumSelect label="Interaction" value={o.interaction} options={[{ value: "none", label: "None" }, { value: "hover-highlight", label: "Hover highlight" }, { value: "click-focus", label: "Click to focus" }, { value: "click-toggle-animation", label: "Click toggles motion" }]} onChange={(v) => set((x) => void (x.interaction = v))} /></Row>
        <Row label="Game role"><EnumSelect label="Game role" value={o.role} options={["none", "player", "collectible", "obstacle"] as const} onChange={(v) => set((x) => void (x.role = v))} /></Row>
      </Section>
    </>
  );
}

function LightInspector({ id }: { id: string }) {
  const l = useSceneEditor((s) => s.scene?.lights.find((x) => x.id === id));
  const { updateLight } = useSceneEditor.getState();
  if (!l) return null;
  const set = (fn: (x: LightSpec) => void, key?: string) => updateLight(l.id, fn, key);
  return (
    <Section title="Light">
      <Row label="Name"><input value={l.name} onChange={(e) => set((x) => void (x.name = e.target.value.slice(0, 80)), "name")} aria-label="Light name" className="h-7 w-full rounded-md border border-input bg-background/60 px-2 text-xs outline-none focus:border-ring" /></Row>
      <Row label="Type"><EnumSelect label="Light type" value={l.type} options={["ambient", "directional", "point", "spot", "hemisphere"] as const} onChange={(v) => set((x) => void (x.type = v))} /></Row>
      <Row label="Color"><ColorInput label="Light color" value={l.color} onChange={(v) => set((x) => void (x.color = v), "color")} /></Row>
      {l.type === "hemisphere" && <Row label="Ground"><ColorInput label="Ground color" value={l.groundColor} onChange={(v) => set((x) => void (x.groundColor = v), "ground")} /></Row>}
      <Row label="Intensity"><NumberInput label="Intensity" min={0} max={1000} value={l.intensity} onChange={(v) => set((x) => void (x.intensity = v), "intensity")} /></Row>
      {l.type !== "ambient" && l.type !== "hemisphere" && <Row label="Position"><Vec3Input label="Light position" value={l.position} onChange={(v) => set((x) => void (x.position = v), "pos")} /></Row>}
      {(l.type === "point" || l.type === "spot") && <Row label="Distance"><NumberInput label="Distance (0 = infinite)" min={0} max={10000} value={l.distance} onChange={(v) => set((x) => void (x.distance = v), "dist")} /></Row>}
      {l.type === "spot" && <Row label="Angle"><SliderInput label="Cone angle" min={0.05} max={Math.PI / 2} step={0.01} value={l.angle} onChange={(v) => set((x) => void (x.angle = v), "angle")} /></Row>}
      {l.type !== "ambient" && l.type !== "hemisphere" && <Row label="Shadows"><Toggle label="Cast shadows" checked={l.castShadow} onChange={(v) => set((x) => void (x.castShadow = v))} /></Row>}
    </Section>
  );
}

function SceneInspector({ onCaptureCamera }: { onCaptureCamera: () => void }) {
  const scene = useSceneEditor((s) => s.scene);
  const { update } = useSceneEditor.getState();
  if (!scene) return null;
  const env = scene.environment;
  return (
    <>
      <Section title="Scene">
        <Row label="Title"><input value={scene.title} onChange={(e) => update((s) => void (s.title = e.target.value.slice(0, 80)), "title")} aria-label="Scene title" className="h-7 w-full rounded-md border border-input bg-background/60 px-2 text-xs outline-none focus:border-ring" /></Row>
        <Row label="Description"><textarea value={scene.description} onChange={(e) => update((s) => void (s.description = e.target.value.slice(0, 400)), "desc")} aria-label="Description" rows={2} className="w-full resize-none rounded-md border border-input bg-background/60 px-2 py-1 text-xs outline-none focus:border-ring" /></Row>
      </Section>
      <Section title="Environment">
        <Row label="Background"><ColorInput label="Background" value={env.background} onChange={(v) => update((s) => void (s.environment.background = v), "bg")} /></Row>
        <Row label="Reflections"><EnumSelect label="Environment preset" value={env.preset} options={["none", "studio", "sunset", "night", "city"] as const} onChange={(v) => update((s) => void (s.environment.preset = v))} /></Row>
        <Row label="Exposure"><SliderInput label="Exposure" min={0.1} max={4} step={0.05} value={env.exposure} onChange={(v) => update((s) => void (s.environment.exposure = v), "exp")} /></Row>
        <Row label="Shadows"><Toggle label="Shadows" checked={env.shadows} onChange={(v) => update((s) => void (s.environment.shadows = v))} /></Row>
        <Row label="Grid"><Toggle label="Grid" checked={env.grid} onChange={(v) => update((s) => void (s.environment.grid = v))} /></Row>
        <Row label="Ground"><Toggle label="Ground plane" checked={env.ground} onChange={(v) => update((s) => void (s.environment.ground = v))} /></Row>
        {env.ground && <Row label="Ground color"><ColorInput label="Ground color" value={env.groundColor} onChange={(v) => update((s) => void (s.environment.groundColor = v), "gc")} /></Row>}
        <Row label="Fog"><Toggle label="Fog" checked={env.fog} onChange={(v) => update((s) => void (s.environment.fog = v))} /></Row>
        {env.fog && (
          <>
            <Row label="Fog color"><ColorInput label="Fog color" value={env.fogColor} onChange={(v) => update((s) => void (s.environment.fogColor = v), "fc")} /></Row>
            <Row label="Fog range">
              <div className="grid grid-cols-2 gap-1">
                <NumberInput label="Fog near" min={0} value={env.fogNear} onChange={(v) => update((s) => void (s.environment.fogNear = v), "fn")} />
                <NumberInput label="Fog far" min={0} value={env.fogFar} onChange={(v) => update((s) => void (s.environment.fogFar = v), "ff")} />
              </div>
            </Row>
          </>
        )}
      </Section>
      <Section title="Camera">
        <Row label="Position"><Vec3Input label="Camera position" value={scene.camera.position} onChange={(v) => update((s) => void (s.camera.position = v), "cpos")} /></Row>
        <Row label="Target"><Vec3Input label="Camera target" value={scene.camera.target} onChange={(v) => update((s) => void (s.camera.target = v), "ctar")} /></Row>
        <Row label="FOV"><SliderInput label="Field of view" min={10} max={120} step={1} value={scene.camera.fov} onChange={(v) => update((s) => void (s.camera.fov = v), "fov")} /></Row>
        <Row label="Auto-rotate"><Toggle label="Auto-rotate in play mode" checked={scene.camera.autoRotate} onChange={(v) => update((s) => void (s.camera.autoRotate = v))} /></Row>
        <Button size="xs" variant="secondary" onClick={onCaptureCamera}><Camera /> Use current view</Button>
      </Section>
      <Section title="Controls & timeline">
        <Row label="Mode"><EnumSelect label="Controls mode" value={scene.controls.mode} options={[{ value: "orbit", label: "Orbit camera" }, { value: "player", label: "Playable (WASD)" }]} onChange={(v) => update((s) => void (s.controls.mode = v))} /></Row>
        {scene.controls.mode === "player" && (
          <>
            <Row label="Speed"><NumberInput label="Player speed" min={0} max={100} value={scene.controls.playerSpeed} onChange={(v) => update((s) => void (s.controls.playerSpeed = v), "ps")} /></Row>
            <Row label="Bounds"><NumberInput label="Arena half-size" min={1} max={1000} value={scene.controls.bounds} onChange={(v) => update((s) => void (s.controls.bounds = v), "pb")} /></Row>
          </>
        )}
        <Row label="Duration s"><NumberInput label="Timeline duration" min={1} max={600} step={1} value={scene.timeline.duration} onChange={(v) => update((s) => void (s.timeline.duration = v), "dur")} /></Row>
        <Row label="Loop"><Toggle label="Loop timeline" checked={scene.timeline.loop} onChange={(v) => update((s) => void (s.timeline.loop = v))} /></Row>
      </Section>
    </>
  );
}

export function Inspector({ onCaptureCamera }: { onCaptureCamera: () => void }) {
  const selection = useSceneEditor((s) => s.selection);
  const obj = useSceneEditor((s) => (s.selection?.kind === "object" ? s.scene?.objects.find((o) => o.id === (s.selection as { id: string }).id) : undefined));
  return (
    <div className="h-full overflow-y-auto thin-scroll" aria-label="Inspector">
      {selection?.kind === "object" && obj ? <ObjectInspector key={obj.id} o={obj} /> : selection?.kind === "light" ? <LightInspector id={selection.id} /> : <SceneInspector onCaptureCamera={onCaptureCamera} />}
    </div>
  );
}
