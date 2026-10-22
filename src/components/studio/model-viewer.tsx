"use client";

import { Canvas } from "@react-three/fiber";
import { Bounds, Center, Environment, Lightformer, OrbitControls, useGLTF } from "@react-three/drei";
import { Component, Suspense, type ReactNode } from "react";

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return (
    <Center>
      <primitive object={scene} />
    </Center>
  );
}

class ViewerBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? <p className="p-6 text-center text-sm text-muted-foreground">This model could not be displayed. You can still download it.</p> : this.props.children;
  }
}

/** Interactive GLB preview for generated or uploaded 3D models. */
export function ModelViewer({ url }: { url: string }) {
  return (
    <div className="h-80 w-full overflow-hidden rounded-lg border border-border bg-[#0d0d11]">
      <ViewerBoundary>
        <Canvas camera={{ position: [2.5, 1.8, 2.5], fov: 45 }} dpr={[1, 2]}>
          <ambientLight intensity={0.4} />
          <directionalLight position={[3, 5, 3]} intensity={2} />
          <Suspense fallback={null}>
            <Bounds fit clip observe margin={1.2}>
              <Model url={url} />
            </Bounds>
            <Environment resolution={64}>
              <Lightformer intensity={2} position={[0, 4, -6]} scale={[8, 4, 1]} />
              <Lightformer intensity={1} position={[-5, 2, 3]} scale={[4, 2, 1]} />
            </Environment>
          </Suspense>
          <OrbitControls makeDefault />
        </Canvas>
      </ViewerBoundary>
    </div>
  );
}
