const assert = require("node:assert/strict");
const test = require("node:test");
const agentBrain = require("../js/agent-brain.js");

function createBrainHarness({ mobile = false, visibilityState = "visible", rendererFailure = false } = {}) {
  const calls = {
    renders: 0,
    setPixelRatio: [],
    setSize: [],
    rendererOptions: null,
    rendererDisposed: 0,
    contextLost: false,
    geometryDisposed: 0,
    materialDisposed: 0,
    computedNormals: 0,
    sphereGeometryArgs: [],
    surfaceGeometries: [],
    meshes: [],
    brainGroups: [],
    materialInstances: [],
    lineSegmentGeometries: [],
    points: [],
    cancelledFrames: [],
    disconnectedObservers: 0,
    windowListeners: new Map(),
    documentListeners: new Map(),
    frameCallbacks: new Map()
  };
  let nextFrameId = 0;

  function createAttribute(points) {
    const array = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      array[index * 3] = point.x;
      array[index * 3 + 1] = point.y;
      array[index * 3 + 2] = point.z;
    });
    return {
      array,
      count: points.length,
      needsUpdate: false,
      getX(index) {
        return array[index * 3];
      },
      getY(index) {
        return array[index * 3 + 1];
      },
      getZ(index) {
        return array[index * 3 + 2];
      },
      setXYZ(index, x, y, z) {
        array[index * 3] = x;
        array[index * 3 + 1] = y;
        array[index * 3 + 2] = z;
      }
    };
  }

  class FakeVector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
  }

  class FakeObject3D {
    constructor() {
      this.children = [];
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
          this.x = x;
          this.y = y;
          this.z = z;
        }
      };
      this.rotation = {
        x: 0,
        y: 0,
        z: 0,
        set(x, y, z) {
          this.x = x;
          this.y = y;
          this.z = z;
        }
      };
      this.scale = {
        x: 1,
        y: 1,
        z: 1,
        set(x, y, z) {
          this.x = x;
          this.y = y;
          this.z = z;
        }
      };
    }
    add(...children) {
      this.children.push(...children);
    }
  }

  class FakeGeometry {
    constructor() {
      this.points = [];
      this.attributes = {};
      this.drawRange = { start: 0, count: Infinity };
    }
    setFromPoints(points) {
      this.points = points;
      this.attributes.position = createAttribute(points);
      return this;
    }
    setAttribute(name, attribute) {
      this.attributes[name] = attribute;
      return this;
    }
    getAttribute(name) {
      return this.attributes[name];
    }
    computeVertexNormals() {
      calls.computedNormals += 1;
    }
    setDrawRange(start, count) {
      this.drawRange = { start, count };
    }
    dispose() {
      calls.geometryDisposed += 1;
    }
  }

  class FakeSphereGeometry extends FakeGeometry {
    constructor(radius, widthSegments, heightSegments) {
      super();
      calls.sphereGeometryArgs.push([radius, widthSegments, heightSegments]);
      const points = [];
      for (let row = 0; row <= heightSegments; row += 1) {
        const phi = (row / heightSegments) * Math.PI;
        for (let column = 0; column <= widthSegments; column += 1) {
          const theta = (column / widthSegments) * Math.PI * 2;
          points.push(new FakeVector3(
            -radius * Math.cos(theta) * Math.sin(phi),
            radius * Math.cos(phi),
            radius * Math.sin(theta) * Math.sin(phi)
          ));
        }
      }
      this.attributes.position = createAttribute(points);
      calls.surfaceGeometries.push(this);
    }
  }

  class FakeBufferAttribute {
    constructor(array, itemSize) {
      this.array = array;
      this.itemSize = itemSize;
      this.count = array.length / itemSize;
      this.needsUpdate = false;
    }
    setXYZ(index, x, y, z) {
      this.array[index * this.itemSize] = x;
      this.array[index * this.itemSize + 1] = y;
      this.array[index * this.itemSize + 2] = z;
    }
  }

  class FakeMaterial {
    constructor(options) {
      Object.assign(this, options);
      this.color = {
        value: options.color,
        setHex(value) {
          this.value = value;
        }
      };
      if (options.emissive !== undefined) {
        this.emissive = {
          value: options.emissive,
          setHex(value) {
            this.value = value;
          }
        };
      }
      calls.materialInstances.push(this);
    }
    dispose() {
      calls.materialDisposed += 1;
    }
  }

  class FakeRenderer {
    constructor(options) {
      if (rendererFailure) {
        throw new Error("WebGL is unavailable.");
      }
      calls.rendererOptions = options;
      this.domElement = {
        parentNode: null,
        setAttribute(name, value) {
          this[name] = value;
        }
      };
    }
    getContext() {
      return { isContextLost: () => calls.contextLost };
    }
    setPixelRatio(value) {
      calls.setPixelRatio.push(value);
    }
    setSize(width, height, updateStyle) {
      calls.setSize.push({ width, height, updateStyle });
    }
    render() {
      calls.renders += 1;
    }
    dispose() {
      calls.rendererDisposed += 1;
    }
  }

  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target) {
      this.target = target;
    }
    disconnect() {
      calls.disconnectedObservers += 1;
    }
  }

  const THREE = {
    Scene: FakeObject3D,
    PerspectiveCamera: class extends FakeObject3D {
      updateProjectionMatrix() {}
    },
    Group: class extends FakeObject3D {
      constructor() {
        super();
        calls.brainGroups.push(this);
      }
    },
    SphereGeometry: FakeSphereGeometry,
    BufferGeometry: FakeGeometry,
    BufferAttribute: FakeBufferAttribute,
    MeshPhongMaterial: FakeMaterial,
    MeshBasicMaterial: FakeMaterial,
    LineBasicMaterial: FakeMaterial,
    PointsMaterial: FakeMaterial,
    AmbientLight: FakeObject3D,
    PointLight: class extends FakeObject3D {
      constructor(color) {
        super();
        this.color = {
          value: color,
          setHex(value) {
            this.value = value;
          }
        };
      }
    },
    Mesh: class extends FakeObject3D {
      constructor(geometry, material) {
        super();
        this.geometry = geometry;
        this.material = material;
        calls.meshes.push(this);
      }
    },
    Line: class extends FakeObject3D {
      constructor(geometry, material) {
        super();
        this.geometry = geometry;
        this.material = material;
      }
    },
    LineSegments: class extends FakeObject3D {
      constructor(geometry, material) {
        super();
        this.geometry = geometry;
        this.material = material;
        calls.lineSegmentGeometries.push(geometry);
      }
    },
    Points: class extends FakeObject3D {
      constructor(geometry, material) {
        super();
        this.geometry = geometry;
        this.material = material;
        calls.points.push(this);
      }
    },
    Vector3: FakeVector3,
    WebGLRenderer: FakeRenderer,
    AdditiveBlending: 2,
    BackSide: 1,
    DoubleSide: 2
  };

  const container = {
    clientWidth: mobile ? 360 : 900,
    clientHeight: mobile ? 200 : 240,
    dataset: {},
    attributes: {},
    children: [],
    replaceChildren() {
      for (const child of this.children) {
        child.parentNode = null;
      }
      this.children = [];
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      child.parentNode = null;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
  const stateElement = { dataset: {} };
  const documentRef = {
    visibilityState,
    addEventListener(name, callback) {
      calls.documentListeners.set(name, callback);
    },
    removeEventListener(name) {
      calls.documentListeners.delete(name);
    }
  };
  const windowRef = {
    devicePixelRatio: 3,
    ResizeObserver: FakeResizeObserver,
    matchMedia(query) {
      return { matches: query === "(max-width: 600px)" && mobile };
    },
    requestAnimationFrame(callback) {
      const id = ++nextFrameId;
      calls.frameCallbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      calls.cancelledFrames.push(id);
      calls.frameCallbacks.delete(id);
    },
    addEventListener(name, callback) {
      calls.windowListeners.set(name, callback);
    },
    removeEventListener(name) {
      calls.windowListeners.delete(name);
    }
  };

  return {
    calls,
    container,
    documentRef,
    stateElement,
    THREE,
    windowRef
  };
}

test("Agent Brain maps all database states and unknown values safely", () => {
  assert.equal(agentBrain.mapAgentStatus("active").status, "ACTIVE");
  assert.equal(agentBrain.mapAgentStatus("ANALYZING").activityPoints, 48);
  assert.ok(agentBrain.mapAgentStatus("ANALYZING").pulseSpeed
    > agentBrain.mapAgentStatus("ACTIVE").pulseSpeed);
  assert.equal(agentBrain.mapAgentStatus("IDLE").mode, "breathing");
  assert.equal(agentBrain.mapAgentStatus("STOPPED").animated, false);
  assert.equal(agentBrain.mapAgentStatus("ERROR").mode, "warning");
  assert.ok(agentBrain.pulseIntensity(agentBrain.mapAgentStatus("ERROR"), 0.2, 0)
    > agentBrain.pulseIntensity(agentBrain.mapAgentStatus("ERROR"), 2.2, 0));
  assert.equal(agentBrain.mapAgentStatus(null).status, "UNKNOWN");
  assert.equal(agentBrain.mapAgentStatus("unrecognized").mode, "neutral");
});

test("Agent Brain caps renderer pixel ratio for desktop and mobile performance", () => {
  assert.equal(agentBrain.getPixelRatio(3, false), 1.5);
  assert.equal(agentBrain.getPixelRatio(3, true), 1.25);
  assert.equal(agentBrain.getPixelRatio(1, false), 1);
  assert.equal(agentBrain.getPixelRatio(0, false), 1);
  assert.equal(agentBrain.performanceLimits.maxFramesPerSecond, 30);
  assert.equal(agentBrain.performanceLimits.maxActivityPoints, 48);
  assert.equal(agentBrain.performanceLimits.maxNeuralNodes, 720);
  assert.equal(agentBrain.performanceLimits.maxConnections, 2160);
});

test("Agent Brain uses layered status-driven glow without rotating the brain volume", () => {
  const harness = createBrainHarness();
  const brain = agentBrain.createAgentBrain({
    THREE: harness.THREE,
    container: harness.container,
    windowRef: harness.windowRef,
    documentRef: harness.documentRef,
    initialStatus: "IDLE"
  });
  const shellMaterial = harness.calls.meshes[0].material;
  const innerGlowMaterial = harness.calls.meshes[1].material;
  const brainGroup = harness.calls.brainGroups[0];

  brain.setStatus("ACTIVE");
  const activeIntensity = shellMaterial.emissiveIntensity;
  const activeOpacity = shellMaterial.opacity;
  const activeInnerGlow = innerGlowMaterial.opacity;
  brain.setStatus("ANALYZING");
  assert.ok(shellMaterial.emissiveIntensity > activeIntensity);
  assert.ok(shellMaterial.opacity > activeOpacity);
  assert.ok(innerGlowMaterial.opacity > activeInnerGlow);

  brain.setStatus("IDLE");
  assert.ok(shellMaterial.opacity < activeOpacity);
  brain.setStatus("STOPPED");
  assert.equal(harness.calls.frameCallbacks.size, 0);
  assert.ok(shellMaterial.emissiveIntensity < activeIntensity);
  brain.setStatus("ERROR");
  assert.equal(shellMaterial.emissive.value, 0xff4655);

  const runFrame = (timestamp) => {
    const [frameId, callback] = harness.calls.frameCallbacks.entries().next().value;
    harness.calls.frameCallbacks.delete(frameId);
    callback(timestamp);
  };
  runFrame(200);
  const warningGlow = shellMaterial.emissiveIntensity;
  runFrame(1600);
  assert.ok(shellMaterial.emissiveIntensity < warningGlow);
  assert.equal(brainGroup.rotation.x, 0);
  assert.equal(brainGroup.rotation.y, 0);

  brain.dispose();
});

test("Agent Brain initializes a low-power renderer and pauses/resumes animation with page visibility", () => {
  const harness = createBrainHarness();
  const brain = agentBrain.createAgentBrain({
    THREE: harness.THREE,
    container: harness.container,
    stateElement: harness.stateElement,
    windowRef: harness.windowRef,
    documentRef: harness.documentRef,
    initialStatus: "ACTIVE"
  });

  assert.equal(brain.available, true);
  assert.equal(brain.isAvailable(), true);
  assert.equal(harness.calls.rendererOptions.antialias, true);
  assert.equal(harness.calls.rendererOptions.powerPreference, "low-power");
  assert.deepEqual(harness.calls.sphereGeometryArgs, [
    [1, 40, 32],
    [1, 40, 32],
    [1, 28, 20],
    [1, 20, 16]
  ]);
  assert.equal(harness.calls.surfaceGeometries.length, 4);
  assert.equal(harness.calls.computedNormals, 4);
  assert.equal(harness.calls.meshes.length, 6);
  assert.equal(harness.calls.meshes[0].geometry, harness.calls.surfaceGeometries[0]);
  assert.equal(harness.calls.meshes[2].geometry, harness.calls.surfaceGeometries[1]);
  assert.equal(harness.calls.meshes[0].position.x, -0.255);
  assert.equal(harness.calls.meshes[2].position.x, 0.255);
  assert.equal(harness.calls.meshes[0].material, harness.calls.meshes[2].material);
  const shellMaterial = harness.calls.meshes[0].material;
  const innerGlowMaterial = harness.calls.meshes[1].material;
  assert.equal(innerGlowMaterial.blending, harness.THREE.AdditiveBlending);
  assert.equal(shellMaterial.shininess, 66);
  const leftSurface = harness.calls.surfaceGeometries[0].getAttribute("position");
  const rightSurface = harness.calls.surfaceGeometries[1].getAttribute("position");
  let minSurfaceX = Infinity;
  let maxSurfaceX = -Infinity;
  let minSurfaceY = Infinity;
  let maxSurfaceY = -Infinity;
  for (const [surface, offsetX] of [[leftSurface, -0.255], [rightSurface, 0.255]]) {
    for (let index = 0; index < surface.count; index += 1) {
      minSurfaceX = Math.min(minSurfaceX, surface.getX(index) + offsetX);
      maxSurfaceX = Math.max(maxSurfaceX, surface.getX(index) + offsetX);
      minSurfaceY = Math.min(minSurfaceY, surface.getY(index));
      maxSurfaceY = Math.max(maxSurfaceY, surface.getY(index));
    }
  }
  const surfaceWidth = maxSurfaceX - minSurfaceX;
  const surfaceHeight = maxSurfaceY - minSurfaceY;
  assert.ok(surfaceWidth > surfaceHeight * 1.15);
  const neuralNodes = harness.calls.points.find(({ material }) => material.size === 0.014);
  assert.equal(neuralNodes.geometry.getAttribute("position").count, 720);
  const networkPositions = neuralNodes.geometry.getAttribute("position");
  let networkMaxX = 0;
  for (let index = 0; index < networkPositions.count; index += 1) {
    networkMaxX = Math.max(networkMaxX, Math.abs(networkPositions.getX(index)));
  }
  assert.ok(networkMaxX < Math.max(Math.abs(minSurfaceX), Math.abs(maxSurfaceX)));
  const connectionPosition = harness.calls.lineSegmentGeometries[0].getAttribute("position");
  assert.ok(connectionPosition.count > 1000);
  assert.ok(harness.calls.lineSegmentGeometries.every((geometry) =>
    geometry === harness.calls.lineSegmentGeometries[0]
  ));
  assert.ok(harness.calls.lineSegmentGeometries[0].getAttribute("position").count
    <= agentBrain.performanceLimits.maxConnections * 2);
  let leftHemisphereConnections = 0;
  let rightHemisphereConnections = 0;
  for (let index = 0; index < connectionPosition.count; index += 2) {
    const midpointX = (connectionPosition.getX(index) + connectionPosition.getX(index + 1)) / 2;
    if (midpointX < -0.12) {
      leftHemisphereConnections += 1;
    } else if (midpointX > 0.12) {
      rightHemisphereConnections += 1;
    }
  }
  const hemisphereBalance = Math.min(leftHemisphereConnections, rightHemisphereConnections)
    / Math.max(leftHemisphereConnections, rightHemisphereConnections);
  assert.ok(hemisphereBalance > 0.65);
  assert.deepEqual(harness.calls.setPixelRatio, [1.5]);
  assert.ok(harness.calls.setSize.some(({ width, height }) => width === 900 && height === 240));
  assert.equal(harness.container.children.length, 1);
  assert.equal(harness.stateElement.dataset.state, "active");
  assert.equal(harness.calls.frameCallbacks.size, 1);

  const visibilityListener = harness.calls.documentListeners.get("visibilitychange");
  harness.documentRef.visibilityState = "hidden";
  visibilityListener();
  assert.equal(harness.calls.frameCallbacks.size, 0);
  assert.equal(harness.calls.cancelledFrames.length, 1);

  harness.documentRef.visibilityState = "visible";
  visibilityListener();
  assert.equal(harness.calls.frameCallbacks.size, 1);
  brain.setStatus("STOPPED");
  assert.equal(harness.stateElement.dataset.state, "stopped");
  const stoppedColor = harness.calls.points.find(({ material }) => material.size === 0.014)
    .material.color.value;
  const stoppedChannels = [
    (stoppedColor >> 16) & 0xff,
    (stoppedColor >> 8) & 0xff,
    stoppedColor & 0xff
  ];
  assert.ok(Math.max(...stoppedChannels) - Math.min(...stoppedChannels) < 35);
  assert.equal(harness.calls.frameCallbacks.size, 0);
  assert.ok(harness.calls.renders >= 3);

  brain.dispose();
  assert.equal(brain.isAvailable(), false);
  assert.equal(harness.calls.rendererDisposed, 1);
  assert.ok(harness.calls.geometryDisposed > 0);
  assert.ok(harness.calls.materialDisposed > 0);
  assert.equal(harness.calls.disconnectedObservers, 1);
  assert.equal(harness.calls.documentListeners.size, 0);
  assert.equal(harness.calls.windowListeners.size, 0);
  assert.equal(harness.container.children.length, 0);
});

test("Agent Brain reports a lost WebGL context as unavailable", () => {
  const harness = createBrainHarness();
  const brain = agentBrain.createAgentBrain({
    THREE: harness.THREE,
    container: harness.container,
    windowRef: harness.windowRef,
    documentRef: harness.documentRef,
    initialStatus: "ACTIVE"
  });

  assert.equal(brain.isAvailable(), true);
  harness.calls.contextLost = true;
  assert.equal(brain.isAvailable(), false);
  brain.dispose();
});

test("Agent Brain applies the mobile pixel-ratio safeguard and frame-rate cap", () => {
  const harness = createBrainHarness({ mobile: true });
  const brain = agentBrain.createAgentBrain({
    THREE: harness.THREE,
    container: harness.container,
    windowRef: harness.windowRef,
    documentRef: harness.documentRef,
    initialStatus: "ANALYZING"
  });
  assert.equal(harness.calls.rendererOptions.antialias, false);
  assert.deepEqual(harness.calls.setPixelRatio, [1.25]);
  const initialRenderCount = harness.calls.renders;
  const brainGroup = harness.calls.brainGroups[0];
  const initialScale = { ...brainGroup.scale };

  const [frameId, firstFrame] = harness.calls.frameCallbacks.entries().next().value;
  harness.calls.frameCallbacks.delete(frameId);
  firstFrame(16);
  assert.equal(harness.calls.renders, initialRenderCount);
  const [nextFrameId, secondFrame] = harness.calls.frameCallbacks.entries().next().value;
  const energyGeometry = harness.calls.points.find(({ material }) => material.size === 0.065).geometry;
  const energyPositions = energyGeometry.getAttribute("position");
  const initialEnergyPositions = [...energyPositions.array];
  const linePositions = harness.calls.lineSegmentGeometries[0].getAttribute("position");
  const initialLinePositions = [...linePositions.array];
  const connectionColors = harness.calls.lineSegmentGeometries[0].getAttribute("color");
  const initialConnectionColors = [...connectionColors.array];
  harness.calls.frameCallbacks.delete(nextFrameId);
  secondFrame(34);
  assert.equal(harness.calls.renders, initialRenderCount + 1);
  assert.equal(energyPositions.needsUpdate, true);
  assert.notDeepEqual([...energyPositions.array], initialEnergyPositions);
  assert.equal(linePositions.needsUpdate, true);
  assert.notDeepEqual([...linePositions.array], initialLinePositions);
  assert.equal(connectionColors.needsUpdate, true);
  assert.notDeepEqual([...connectionColors.array], initialConnectionColors);
  assert.equal(brainGroup.rotation.x, 0);
  assert.equal(brainGroup.rotation.y, 0);
  assert.deepEqual(brainGroup.scale, initialScale);

  brain.dispose();
  assert.equal(harness.calls.frameCallbacks.size, 0);
});

test("Agent Brain falls back safely when WebGL initialization is unavailable", () => {
  const harness = createBrainHarness({ rendererFailure: true });

  assert.doesNotThrow(() => {
    const brain = agentBrain.createAgentBrain({
      THREE: harness.THREE,
      container: harness.container,
      windowRef: harness.windowRef,
      documentRef: harness.documentRef,
      initialStatus: null
    });
    assert.equal(brain.available, false);
    brain.setStatus("UNKNOWN");
    brain.dispose();
  });
  assert.equal(harness.container.children.length, 0);
});
