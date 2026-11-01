(function attachAgentBrain(root, createApi) {
  const api = createApi();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.CryptoPulseAgentBrain = api;
  }
})(globalThis, function createAgentBrainApi() {
  const statusMap = Object.freeze({
    ACTIVE: Object.freeze({
      status: "ACTIVE",
      color: 0x389cff,
      emissiveIntensity: 0.95,
      pulseSpeed: 1.7,
      pulseAmount: 0.035,
      activationThreshold: 0.82,
      neuronBaseline: 0.055,
      neuronGain: 0.95,
      signalSpeed: 0.72,
      connectionPulseGain: 0.78,
      activityPoints: 28,
      animated: true,
      mode: "continuous"
    }),
    ANALYZING: Object.freeze({
      status: "ANALYZING",
      color: 0x36b8ff,
      emissiveIntensity: 2.4,
      pulseSpeed: 4.2,
      pulseAmount: 0.07,
      activationThreshold: 0.62,
      neuronBaseline: 0.07,
      neuronGain: 0.98,
      signalSpeed: 0.82,
      connectionPulseGain: 1,
      activityPoints: 48,
      animated: true,
      mode: "continuous"
    }),
    IDLE: Object.freeze({
      status: "IDLE",
      color: 0x76aee2,
      emissiveIntensity: 0.35,
      pulseSpeed: 0.48,
      pulseAmount: 0.018,
      activationThreshold: 0.975,
      neuronBaseline: 0.025,
      neuronGain: 0.78,
      signalSpeed: 0.48,
      connectionPulseGain: 0.58,
      activityPoints: 4,
      animated: true,
      mode: "breathing"
    }),
    STOPPED: Object.freeze({
      status: "STOPPED",
      color: 0x87919b,
      emissiveIntensity: 0.08,
      pulseSpeed: 0,
      pulseAmount: 0,
      activationThreshold: 1.1,
      neuronBaseline: 0.018,
      neuronGain: 0,
      signalSpeed: 0,
      connectionPulseGain: 0,
      activityPoints: 0,
      animated: false,
      mode: "static"
    }),
    ERROR: Object.freeze({
      status: "ERROR",
      color: 0xff4655,
      emissiveIntensity: 1.7,
      pulseSpeed: 2.6,
      pulseAmount: 0.055,
      activationThreshold: 0.78,
      neuronBaseline: 0.045,
      neuronGain: 0.95,
      signalSpeed: 0.72,
      connectionPulseGain: 0.9,
      activityPoints: 20,
      animated: true,
      mode: "warning"
    }),
    UNKNOWN: Object.freeze({
      status: "UNKNOWN",
      color: 0x8c99a6,
      emissiveIntensity: 0.12,
      pulseSpeed: 0,
      pulseAmount: 0,
      activationThreshold: 1.1,
      neuronBaseline: 0.025,
      neuronGain: 0,
      signalSpeed: 0,
      connectionPulseGain: 0,
      activityPoints: 0,
      animated: false,
      mode: "neutral"
    })
  });

  const performanceLimits = Object.freeze({
    maxFramesPerSecond: 30,
    maxPixelRatio: 1.5,
    mobilePixelRatio: 1.25,
    maxActivityPoints: 48,
    maxNeuralNodes: 720,
    maxConnections: 2160
  });

  function mapAgentStatus(status) {
    const key = typeof status === "string" ? status.trim().toUpperCase() : "";
    return statusMap[key] || statusMap.UNKNOWN;
  }

  function getPixelRatio(devicePixelRatio, isMobile) {
    const requestedRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
    return Math.min(
      requestedRatio,
      isMobile ? performanceLimits.mobilePixelRatio : performanceLimits.maxPixelRatio
    );
  }

  function createAgentBrain({
    THREE,
    container,
    stateElement = container,
    windowRef = window,
    documentRef = document,
    initialStatus = null
  } = {}) {
    const unavailableBrain = {
      available: false,
      isAvailable() {
        return false;
      },
      setStatus() {},
      dispose() {}
    };

    if (!THREE || !container || typeof THREE.WebGLRenderer !== "function") {
      return unavailableBrain;
    }

    let renderer;
    let resizeObserver;
    let animationFrame = null;
    let disposed = false;
    let visible = documentRef.visibilityState !== "hidden";
    let lastRenderAt = 0;
    let resizeHandler = null;
    let visibilityHandler = null;
    let pageHideHandler = null;
    let pageShowHandler = null;
    let config = mapAgentStatus(initialStatus);
    const geometries = new Set();
    const materials = new Set();

    try {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
      camera.position.z = 2.45;
      const mobileViewport = isMobileViewport(windowRef, container);
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: !mobileViewport,
        powerPreference: "low-power"
      });
      const pixelRatio = getPixelRatio(
        windowRef.devicePixelRatio,
        mobileViewport
      );
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(1, 1, false);
      renderer.domElement.className = "agent-brain-canvas";
      if (typeof renderer.domElement.setAttribute === "function") {
        renderer.domElement.setAttribute("aria-hidden", "true");
      }
      container.replaceChildren();
      container.appendChild(renderer.domElement);

      const brain = new THREE.Group();
      scene.add(brain);
      const neuralLayout = createNeuralLayout(THREE);
      const nodePositions = neuralLayout.nodePositions;
      const connectionPairs = neuralLayout.connectionPairs;
      const connectionWeights = neuralLayout.connectionWeights;
      const hotspotIndices = neuralLayout.hotspotIndices;
      const signalRoutes = createSignalRoutes(connectionPairs, nodePositions.length);
      const neuronActivity = new Float32Array(nodePositions.length);
      const connectionActivity = new Float32Array(connectionPairs.length);
      const connectionSignalProgress = new Float32Array(connectionPairs.length);
      const connectionsGeometry = trackGeometry(geometries, new THREE.BufferGeometry());
      connectionsGeometry.setFromPoints(createConnectionLinePoints(nodePositions, connectionPairs));
      const connectionPositionAttribute = connectionsGeometry.getAttribute("position");
      const connectionColorAttribute = new THREE.BufferAttribute(
        new Float32Array(connectionPairs.length * 6),
        3
      );
      connectionsGeometry.setAttribute("color", connectionColorAttribute);
      const connectionMaterial = trackMaterial(materials, new THREE.LineBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.4,
        depthTest: false,
        depthWrite: false
      }));
      const connectionGlowMaterial = trackMaterial(materials, new THREE.LineBasicMaterial({
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
      }));
      brain.add(new THREE.LineSegments(connectionsGeometry, connectionGlowMaterial));
      brain.add(new THREE.LineSegments(connectionsGeometry, connectionMaterial));

      const nodeGeometry = trackGeometry(geometries, new THREE.BufferGeometry());
      nodeGeometry.setFromPoints(nodePositions);
      const nodePositionAttribute = nodeGeometry.getAttribute("position");
      const nodeColorAttribute = new THREE.BufferAttribute(
        new Float32Array(nodePositions.length * 3),
        3
      );
      nodeGeometry.setAttribute("color", nodeColorAttribute);
      const animatedNodePositions = new Float32Array(nodePositions.length * 3);
      const nodeGlowMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: config.color,
        size: 0.12,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
      }));
      brain.add(new THREE.Points(nodeGeometry, nodeGlowMaterial));
      const nodeMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: config.color,
        size: 0.045,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false
      }));
      brain.add(new THREE.Points(nodeGeometry, nodeMaterial));

      const hotspotGeometry = trackGeometry(geometries, new THREE.BufferGeometry());
      hotspotGeometry.setFromPoints(hotspotIndices.map((index) => nodePositions[index]));
      const hotspotPositionAttribute = hotspotGeometry.getAttribute("position");
      const hotspotColorAttribute = new THREE.BufferAttribute(
        new Float32Array(hotspotIndices.length * 3),
        3
      );
      hotspotGeometry.setAttribute("color", hotspotColorAttribute);
      const hotspotMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: config.color,
        size: 0.085,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
      }));
      const hotspotGlowMaterial = trackMaterial(materials, new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(config.color) },
          uOpacity: { value: 0.32 },
          uSize: { value: 18 * pixelRatio }
        },
        vertexShader: `
          attribute vec3 color;
          varying vec3 vIntensity;
          uniform float uSize;
          void main() {
            vIntensity = color;
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * viewPosition;
            gl_PointSize = uSize;
          }
        `,
        fragmentShader: `
          varying vec3 vIntensity;
          uniform vec3 uColor;
          uniform float uOpacity;
          void main() {
            float radius = length(gl_PointCoord - vec2(0.5));
            float core = 1.0 - smoothstep(0.04, 0.2, radius);
            float halo = 1.0 - smoothstep(0.08, 0.5, radius);
            float intensity = max(max(vIntensity.r, vIntensity.g), vIntensity.b);
            float alpha = (core * 0.8 + halo * 0.38) * uOpacity * intensity;
            if (alpha < 0.01) discard;
            gl_FragColor = vec4(uColor * vIntensity, alpha);
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false
      }));
      brain.add(new THREE.Points(hotspotGeometry, hotspotGlowMaterial));
      brain.add(new THREE.Points(hotspotGeometry, hotspotMaterial));

      const activityGeometry = trackGeometry(geometries, new THREE.BufferGeometry());
      activityGeometry.setFromPoints(createEnergyParticlePositions(THREE, nodePositions, connectionPairs));
      activityGeometry.setDrawRange(0, config.activityPoints);
      const activityMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: config.color,
        size: 0.075,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.98,
        depthTest: false,
        depthWrite: false
      }));
      const activityGlowMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: config.color,
        size: 0.11,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
      }));
      brain.add(new THREE.Points(activityGeometry, activityGlowMaterial));
      brain.add(new THREE.Points(activityGeometry, activityMaterial));

      const referenceTraceLayout = createReferenceTraceLayout(THREE);
      const referenceTraceGeometry = trackGeometry(geometries, new THREE.BufferGeometry());
      referenceTraceGeometry.setFromPoints(referenceTraceLayout.segmentPoints);
      const referenceTraceStrokeGeometry = trackGeometry(geometries, new THREE.BufferGeometry());
      referenceTraceStrokeGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(referenceTraceLayout.circuitStrokePositions, 3)
      );
      const referenceTraceStrokeMaterial = trackMaterial(materials, new THREE.MeshBasicMaterial({
        color: 0x168fff,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
      }));
      const referenceTraceStroke = new THREE.Mesh(
        referenceTraceStrokeGeometry,
        referenceTraceStrokeMaterial
      );
      referenceTraceStroke.renderOrder = -3;
      const referenceTraceGlowMaterial = trackMaterial(materials, new THREE.LineBasicMaterial({
        color: 0x168fff,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
      }));
      const referenceTraceMaterial = trackMaterial(materials, new THREE.LineBasicMaterial({
        color: 0x4bcfff,
        transparent: true,
        opacity: 0.62,
        depthTest: false,
        depthWrite: false
      }));
      const referenceTraceGlow = new THREE.LineSegments(
        referenceTraceGeometry,
        referenceTraceGlowMaterial
      );
      const referenceTraces = new THREE.LineSegments(
        referenceTraceGeometry,
        referenceTraceMaterial
      );
      referenceTraceGlow.renderOrder = -2;
      referenceTraces.renderOrder = -1;
      brain.add(referenceTraceStroke, referenceTraceGlow, referenceTraces);

      const referenceTraceNodeGeometry = trackGeometry(geometries, new THREE.BufferGeometry());
      referenceTraceNodeGeometry.setFromPoints(referenceTraceLayout.neuronPositions);
      const referenceTraceNodeMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: 0x83eaff,
        size: 0.052,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.88,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
      }));
      const referenceTraceNodes = new THREE.Points(
        referenceTraceNodeGeometry,
        referenceTraceNodeMaterial
      );
      referenceTraceNodes.renderOrder = -1;
      brain.add(referenceTraceNodes);

      const maxTraceSignalCount = referenceTraceLayout.pulseRoutes.length * 2;
      const traceSignalGeometry = trackGeometry(geometries, new THREE.BufferGeometry());
      traceSignalGeometry.setFromPoints(Array.from(
        { length: maxTraceSignalCount },
        (_, index) => referenceTraceLayout.pulseRoutes[
          index % referenceTraceLayout.pulseRoutes.length
        ].points[0]
      ));
      const traceSignalPositionAttribute = traceSignalGeometry.getAttribute("position");
      traceSignalGeometry.setDrawRange(
        0,
        Math.min(config.activityPoints, maxTraceSignalCount)
      );
      const traceSignalGlowMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: 0x23aaff,
        size: 0.13,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
      }));
      const traceSignalMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: 0xd8faff,
        size: 0.065,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.96,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
      }));
      const traceSignalGlow = new THREE.Points(traceSignalGeometry, traceSignalGlowMaterial);
      const traceSignals = new THREE.Points(traceSignalGeometry, traceSignalMaterial);
      traceSignalGlow.renderOrder = 1;
      traceSignals.renderOrder = 2;
      brain.add(traceSignalGlow, traceSignals);

      const analyzingNeuronIndices = Array.from(
        { length: Math.min(52, nodePositions.length) },
        (_, index) => (index * 149 + 37) % nodePositions.length
      );
      const analyzingNeuronGeometry = trackGeometry(geometries, new THREE.BufferGeometry());
      analyzingNeuronGeometry.setFromPoints(
        analyzingNeuronIndices.map((index) => nodePositions[index])
      );
      const analyzingNeuronPositionAttribute = analyzingNeuronGeometry.getAttribute("position");
      const analyzingNeuronGlowMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: 0x39ff91,
        size: 0.13,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
      }));
      const analyzingNeuronMaterial = trackMaterial(materials, new THREE.PointsMaterial({
        color: 0x9bffc1,
        size: 0.058,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.94,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false
      }));
      const analyzingNeuronGlow = new THREE.Points(
        analyzingNeuronGeometry,
        analyzingNeuronGlowMaterial
      );
      const analyzingNeurons = new THREE.Points(
        analyzingNeuronGeometry,
        analyzingNeuronMaterial
      );
      analyzingNeuronGlow.visible = false;
      analyzingNeurons.visible = false;
      analyzingNeuronGlow.renderOrder = 1;
      analyzingNeurons.renderOrder = 2;
      brain.add(analyzingNeuronGlow, analyzingNeurons);

      function updateVisualIntensity(elapsed, breath) {
        const rawIntensity = pulseIntensity(config, elapsed, breath);
        const strength = Math.max(0, Math.min(1, rawIntensity / 2.4));
        const idleBreath = config.mode === "breathing" ? (breath + 1) * 0.5 : 0;
        const warningDim = config.mode === "warning" && rawIntensity < 0.3;
        const visibleStrength = warningDim ? 0.08 : strength;
        connectionMaterial.opacity = 0.3;
        connectionGlowMaterial.opacity = 0.035 + visibleStrength * 0.05;
        nodeMaterial.opacity = 0.96;
        nodeGlowMaterial.opacity = 0.12 + visibleStrength * 0.15 + idleBreath * 0.02;
        hotspotMaterial.opacity = 0.92;
        hotspotGlowMaterial.uniforms.uOpacity.value = 0.15 + visibleStrength * 0.42;
        activityMaterial.opacity = 0.92;
        activityGlowMaterial.opacity = 0.07 + visibleStrength * 0.14;
      }

      function resize() {
        if (disposed) {
          return;
        }
        const width = Math.max(1, container.clientWidth || 320);
        const height = Math.max(1, container.clientHeight || 200);
        camera.aspect = width / height;
        const responsiveScale = Math.min(1.18, 1 + Math.max(0, (camera.aspect - 1.5) * 0.08));
        brain.scale.set(responsiveScale * 1.08, responsiveScale * 1.22, responsiveScale);
        brain.position.y = responsiveScale * 0.55 * 0.13;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        renderStatic();
      }

      function renderStatic() {
        if (!disposed) {
          renderer.render(scene, camera);
        }
      }

      function stopAnimation() {
        if (animationFrame !== null && typeof windowRef.cancelAnimationFrame === "function") {
          windowRef.cancelAnimationFrame(animationFrame);
        }
        animationFrame = null;
      }

      function canAnimate() {
        return !disposed && visible && config.animated
          && typeof windowRef.requestAnimationFrame === "function";
      }

      function isRendererAvailable() {
        if (disposed || !renderer) {
          return false;
        }
        if (typeof renderer.getContext !== "function") {
          return true;
        }
        const context = renderer.getContext();
        return Boolean(context)
          && (typeof context.isContextLost !== "function" || !context.isContextLost());
      }

      function animate(timestamp) {
        animationFrame = null;
        if (!canAnimate()) {
          return;
        }

        const minimumFrameInterval = 1000 / performanceLimits.maxFramesPerSecond;
        if (timestamp - lastRenderAt >= minimumFrameInterval) {
          const elapsed = timestamp * 0.001 * config.pulseSpeed;
          const breath = Math.sin(elapsed);
          updateNeuralNetwork(
            nodePositionAttribute,
          nodeColorAttribute,
          connectionPositionAttribute,
          connectionColorAttribute,
          nodePositions,
          connectionPairs,
          connectionWeights,
          animatedNodePositions,
          neuronActivity,
          connectionActivity,
          connectionSignalProgress,
          signalRoutes,
          config,
          elapsed
          );
          updateHotspotPositions(
          hotspotPositionAttribute,
          animatedNodePositions,
          hotspotIndices
          );
          updateHotspotPositions(
          analyzingNeuronPositionAttribute,
          animatedNodePositions,
          analyzingNeuronIndices
          );
          updateHotspotColors(hotspotColorAttribute, neuronActivity, hotspotIndices);
          updateEnergyParticles(
          activityGeometry,
          connectionPairs,
          signalRoutes,
          animatedNodePositions,
          config.activityPoints,
          elapsed,
          config
          );
          const traceSignalCount = Math.min(config.activityPoints, maxTraceSignalCount);
          updateReferenceTraceParticles(
          traceSignalPositionAttribute,
          referenceTraceLayout.pulseRoutes,
          traceSignalCount,
          elapsed,
          config.signalSpeed
          );
          updateVisualIntensity(elapsed, breath);
          renderer.render(scene, camera);
          lastRenderAt = timestamp;
        }
        animationFrame = windowRef.requestAnimationFrame(animate);
      }

      function startAnimation() {
        if (animationFrame === null && canAnimate()) {
          animationFrame = windowRef.requestAnimationFrame(animate);
        }
      }

      function applyStatus(status) {
        config = mapAgentStatus(status);
        if (stateElement) {
          stateElement.dataset.state = config.status.toLowerCase();
        }
        if (typeof container.setAttribute === "function") {
          container.setAttribute("aria-label", `3D Agent Brain; status ${config.status}`);
        }
        setMaterialColor(connectionMaterial, config.color);
        setMaterialColor(connectionGlowMaterial, config.color);
        setMaterialColor(nodeMaterial, config.color);
        setMaterialColor(nodeGlowMaterial, config.color);
        setMaterialColor(hotspotMaterial, config.color);
        setMaterialColor(hotspotGlowMaterial, config.color);
        setMaterialColor(activityMaterial, config.color);
        setMaterialColor(activityGlowMaterial, config.color);
        const analyzing = config.status === "ANALYZING";
        analyzingNeuronGlow.visible = analyzing;
        analyzingNeurons.visible = analyzing;
        connectionMaterial.color.setHex(0xffffff);
        connectionGlowMaterial.color.setHex(0xffffff);
        activityGeometry.setDrawRange(0, config.activityPoints);
        const traceSignalCount = Math.min(config.activityPoints, maxTraceSignalCount);
        traceSignalGeometry.setDrawRange(0, traceSignalCount);
        updateNeuralNetwork(
          nodePositionAttribute,
          nodeColorAttribute,
          connectionPositionAttribute,
          connectionColorAttribute,
          nodePositions,
          connectionPairs,
          connectionWeights,
          animatedNodePositions,
          neuronActivity,
          connectionActivity,
          connectionSignalProgress,
          signalRoutes,
          config,
          0
        );
        updateHotspotPositions(
          hotspotPositionAttribute,
          animatedNodePositions,
          hotspotIndices
        );
        updateHotspotPositions(
          analyzingNeuronPositionAttribute,
          animatedNodePositions,
          analyzingNeuronIndices
        );
        updateReferenceTraceParticles(
          traceSignalPositionAttribute,
          referenceTraceLayout.pulseRoutes,
          traceSignalCount,
          0,
          config.signalSpeed
        );
        updateHotspotColors(hotspotColorAttribute, neuronActivity, hotspotIndices);
        updateEnergyParticles(
          activityGeometry,
          connectionPairs,
          signalRoutes,
          animatedNodePositions,
          config.activityPoints,
          0,
          config
        );
        updateVisualIntensity(0, 0);
        brain.rotation.set(0, 0, 0);
        lastRenderAt = 0;
        stopAnimation();
        renderStatic();
        startAnimation();
        return config;
      }

      function onVisibilityChange() {
        visible = documentRef.visibilityState !== "hidden";
        if (visible) {
          lastRenderAt = 0;
          renderStatic();
          startAnimation();
        } else {
          stopAnimation();
        }
      }

      function onPageHide(event) {
        if (event && event.persisted) {
          visible = false;
          stopAnimation();
          return;
        }
        disposeResources();
      }

      function onPageShow(event) {
        if (event && event.persisted) {
          onVisibilityChange();
        }
      }

      function disposeResources() {
        if (disposed) {
          return;
        }
        disposed = true;
        stopAnimation();
        if (resizeObserver) {
          resizeObserver.disconnect();
        } else if (typeof windowRef.removeEventListener === "function") {
          windowRef.removeEventListener("resize", resize);
        }
        if (typeof documentRef.removeEventListener === "function") {
          documentRef.removeEventListener("visibilitychange", onVisibilityChange);
        }
        if (typeof windowRef.removeEventListener === "function") {
          windowRef.removeEventListener("pagehide", onPageHide);
          windowRef.removeEventListener("pageshow", onPageShow);
        }
        for (const geometry of geometries) {
          geometry.dispose();
        }
        for (const material of materials) {
          material.dispose();
        }
        if (renderer) {
          renderer.dispose();
          if (renderer.domElement.parentNode === container) {
            container.removeChild(renderer.domElement);
          }
        }
      }

      resizeHandler = resize;
      visibilityHandler = onVisibilityChange;
      pageHideHandler = onPageHide;
      pageShowHandler = onPageShow;
      if (typeof windowRef.ResizeObserver === "function") {
        resizeObserver = new windowRef.ResizeObserver(resize);
        resizeObserver.observe(container);
      } else if (typeof windowRef.addEventListener === "function") {
        windowRef.addEventListener("resize", resize);
      }
      if (typeof documentRef.addEventListener === "function") {
        documentRef.addEventListener("visibilitychange", onVisibilityChange);
      }
      if (typeof windowRef.addEventListener === "function") {
        windowRef.addEventListener("pagehide", onPageHide);
        windowRef.addEventListener("pageshow", onPageShow);
      }

      resize();
      const instance = {
        available: true,
        isAvailable: isRendererAvailable,
        setStatus: applyStatus,
        dispose: disposeResources
      };
      applyStatus(initialStatus);
      return instance;
    } catch (error) {
      if (animationFrame !== null && typeof windowRef.cancelAnimationFrame === "function") {
        windowRef.cancelAnimationFrame(animationFrame);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else if (resizeHandler && typeof windowRef.removeEventListener === "function") {
        windowRef.removeEventListener("resize", resizeHandler);
      }
      if (visibilityHandler && typeof documentRef.removeEventListener === "function") {
        documentRef.removeEventListener("visibilitychange", visibilityHandler);
      }
      if (pageHideHandler && typeof windowRef.removeEventListener === "function") {
        windowRef.removeEventListener("pagehide", pageHideHandler);
      }
      if (pageShowHandler && typeof windowRef.removeEventListener === "function") {
        windowRef.removeEventListener("pageshow", pageShowHandler);
      }
      for (const geometry of geometries) {
        geometry.dispose();
      }
      for (const material of materials) {
        material.dispose();
      }
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
      }
      return { ...unavailableBrain, error };
    }
  }

  function createNeuralLayout(THREE) {
    const nodePositions = [];
    const connectionPairs = [];
    const connectionWeights = [];
    const hotspotIndices = [];

    function addConnection(start, end, weight = 1) {
      connectionPairs.push([start, end]);
      connectionWeights.push(weight);
    }

    function addPath(points, weight = 1, closed = false) {
      const start = nodePositions.length;
      nodePositions.push(...points);
      const end = nodePositions.length;
      for (let index = start; index < end - 1; index += 1) {
        addConnection(index, index + 1, weight);
      }
      if (closed && end - start > 2) {
        addConnection(end - 1, start, weight);
      }
      return Array.from({ length: end - start }, (_, index) => start + index);
    }

    function hemispherePoint(side, localX, y, z) {
      return new THREE.Vector3(side * localX, y, z);
    }

    function createOuterContour(side) {
      const points = [];
      const outerPointCount = 58;
      const contourPointCount = 80;
      for (let index = 0; index < outerPointCount; index += 1) {
        const progress = index / (outerPointCount - 1);
        const width = 0.62 * Math.sin(Math.PI * progress) ** 0.66;
        const lobes = 1 + Math.sin(progress * Math.PI * 3 + 0.3) * 0.05
          + Math.sin(progress * Math.PI * 7 + 1.2) * 0.035
          + Math.sin(progress * Math.PI * 13) * 0.012;
        const y = 0.48 - progress * 0.9 + Math.sin(progress * Math.PI * 6) * 0.012;
        points.push(hemispherePoint(
          side,
          0.05 + width * lobes,
          y,
          0.075 + Math.sin(progress * Math.PI) * 0.045
        ));
      }
      for (let index = 0; index < contourPointCount - outerPointCount; index += 1) {
        const progress = index / (contourPointCount - outerPointCount - 1);
        points.push(hemispherePoint(
          side,
          0.05 + Math.sin(progress * Math.PI * 6) * 0.004,
          -0.42 + progress * 0.9,
          0.075 + Math.sin(progress * Math.PI * 4) * 0.008
        ));
      }
      return points;
    }

    function createGyrusPath(side, pathIndex) {
      const points = [];
      const pointCount = 28;
      const rowProgress = (pathIndex + 1) / 7;
      const centerY = 0.48 - rowProgress * 0.9;
      const width = 0.59 * Math.sin(Math.PI * rowProgress) ** 0.66;
      for (let index = 0; index < pointCount; index += 1) {
        const progress = index / (pointCount - 1);
        const curve = Math.sin(progress * Math.PI * 2 + pathIndex * 0.7)
          * Math.sin(progress * Math.PI) * 0.035
          + Math.sin(progress * Math.PI * 5 + pathIndex * 0.45)
            * Math.sin(progress * Math.PI) * 0.012;
        const y = centerY + curve;
        points.push(hemispherePoint(
          side,
          0.05 + width * progress,
          y,
          0.105 + Math.sin(progress * Math.PI * 3 + pathIndex) * 0.04
        ));
      }
      return points;
    }

    function createBranchPath(side, source, target, progress, branchIndex) {
      const points = [];
      const pointCount = 8;
      const sourceIndex = Math.round(progress * (source.length - 1));
      const targetProgress = Math.max(0.08, Math.min(0.92,
        progress + (branchIndex % 2 === 0 ? 0.14 : -0.11)));
      const targetIndex = Math.round(targetProgress * (target.length - 1));
      const start = nodePositions[source[sourceIndex]];
      const end = nodePositions[target[targetIndex]];
      const bendDirection = branchIndex % 2 === 0 ? 1 : -1;
      for (let index = 0; index < pointCount; index += 1) {
        const progress = index / (pointCount - 1);
        points.push(new THREE.Vector3(
          start.x + (end.x - start.x) * progress
            + side * Math.sin(progress * Math.PI) * 0.025,
          start.y + (end.y - start.y) * progress
            + Math.sin(progress * Math.PI) * bendDirection * 0.035,
          start.z + (end.z - start.z) * progress + Math.sin(progress * Math.PI) * 0.06
        ));
      }
      return { points, sourceIndex, targetIndex };
    }

    const hemispherePaths = [];
    for (const side of [-1, 1]) {
      const start = nodePositions.length;
      const contour = addPath(createOuterContour(side), 1.65, true);
      for (let index = 0; index < contour.length; index += 2) {
        hotspotIndices.push(contour[index]);
      }

      const gyri = [];
      for (let index = 0; index < 6; index += 1) {
        const path = addPath(createGyrusPath(side, index), 1.12);
        gyri.push(path);
        for (const pointIndex of [6, 13, 20]) {
          hotspotIndices.push(path[pointIndex]);
        }
      }

      for (let branchIndex = 0; branchIndex < 10; branchIndex += 1) {
        const sourceIndex = branchIndex % gyri.length;
        const targetIndex = (sourceIndex + 1 + branchIndex % 2) % gyri.length;
        const source = gyri[sourceIndex];
        const target = gyri[targetIndex];
        const progress = 0.12 + ((branchIndex * 0.071) % 0.72);
        const branch = createBranchPath(side, source, target, progress, branchIndex);
        const branchPath = addPath(branch.points, 0.88);
        addConnection(branchPath[0], source[branch.sourceIndex], 0.94);
        addConnection(branchPath[branchPath.length - 1], target[branch.targetIndex], 0.94);
        hotspotIndices.push(branchPath[Math.floor(branchPath.length / 2)]);
      }
      hemispherePaths.push({ side, contour, gyri, start, end: nodePositions.length });
    }

    const cerebellarPaths = [];
    for (const side of [-1, 1]) {
      for (let rowIndex = 0; rowIndex < 2; rowIndex += 1) {
        const points = [];
        for (let index = 0; index < 12; index += 1) {
          const progress = index / 11;
          points.push(hemispherePoint(
            side,
            0.055 + progress * 0.22,
            -0.405 - Math.sin(progress * Math.PI) * (0.04 - rowIndex * 0.01),
            0.12 + rowIndex * 0.035
          ));
        }
        cerebellarPaths.push(addPath(points, 1.05));
      }
    }

    for (let index = 0; index < cerebellarPaths.length; index += 2) {
      const outer = cerebellarPaths[index];
      const inner = cerebellarPaths[index + 1];
      for (let pointIndex = 1; pointIndex < outer.length - 1; pointIndex += 3) {
        addConnection(outer[pointIndex], inner[pointIndex], 0.88);
      }
      const sidePath = hemispherePaths[index / 2];
      addConnection(sidePath.contour[57], outer[0], 1.05);
    }

    const brainstem = [];
    for (let index = 0; index < 16; index += 1) {
      brainstem.push(new THREE.Vector3(
        index % 2 === 0 ? -0.012 : 0.012,
        -0.475 - index * 0.005,
        0.11
      ));
    }
    const brainstemPath = addPath(brainstem, 0.9);
    addConnection(cerebellarPaths[0][0], brainstemPath[0], 0.85);
    addConnection(cerebellarPaths[2][0], brainstemPath[1], 0.85);

    function addLocalConnections(start, end, targetCount) {
      const existing = new Set(connectionPairs.map(([left, right]) =>
        left < right ? `${left}:${right}` : `${right}:${left}`
      ));
      const maxDistanceSquared = 0.32 ** 2;
      const candidatesBySource = [];
      for (let source = start; source < end; source += 1) {
        const candidates = [];
        const sourcePosition = nodePositions[source];
        for (let target = start; target < end; target += 1) {
          if (source === target) {
            continue;
          }
          const targetPosition = nodePositions[target];
          const dx = sourcePosition.x - targetPosition.x;
          const dy = sourcePosition.y - targetPosition.y;
          const dz = sourcePosition.z - targetPosition.z;
          const distanceSquared = dx * dx + dy * dy + dz * dz;
          if (distanceSquared <= maxDistanceSquared) {
            candidates.push({ target, distanceSquared });
          }
        }
        candidates.sort((left, right) => left.distanceSquared - right.distanceSquared);
        candidatesBySource.push(candidates);
      }

      let added = 0;
      const longestCandidateList = Math.max(...candidatesBySource.map((items) => items.length));
      for (
        let candidateRank = 0;
        candidateRank < longestCandidateList && added < targetCount;
        candidateRank += 1
      ) {
        for (let sourceOffset = 0; sourceOffset < candidatesBySource.length; sourceOffset += 1) {
          const candidate = candidatesBySource[sourceOffset][candidateRank];
          if (!candidate) {
            continue;
          }
          const source = start + sourceOffset;
          const left = Math.min(source, candidate.target);
          const right = Math.max(source, candidate.target);
          const key = `${left}:${right}`;
          if (existing.has(key)) {
            continue;
          }
          const distance = Math.sqrt(candidate.distanceSquared);
          const weight = 0.18 + (1 - distance / 0.32) * 0.17;
          addConnection(source, candidate.target, weight);
          existing.add(key);
          added += 1;
          if (added >= targetCount) {
            break;
          }
        }
      }
      return added;
    }

    let remainingConnectionBudget = performanceLimits.maxConnections - connectionPairs.length;
    for (let index = 0; index < hemispherePaths.length; index += 1) {
      const hemispheresRemaining = hemispherePaths.length - index;
      const targetCount = Math.ceil(remainingConnectionBudget / hemispheresRemaining);
      const hemisphere = hemispherePaths[index];
      const added = addLocalConnections(hemisphere.start, hemisphere.end, targetCount);
      remainingConnectionBudget -= added;
    }

    if (
      nodePositions.length !== performanceLimits.maxNeuralNodes
      || connectionPairs.length > performanceLimits.maxConnections
      || connectionWeights.length !== connectionPairs.length
      || hotspotIndices.length > nodePositions.length
    ) {
      throw new Error("Agent Brain neural layout exceeds its performance limits.");
    }

    return {
      connectionPairs,
      connectionWeights,
      hotspotIndices,
      nodePositions
    };
  }

  function createEnergyParticlePositions(THREE, nodePositions, connectionPairs) {
    const points = [];
    for (let index = 0; index < performanceLimits.maxActivityPoints; index += 1) {
      const pair = connectionPairs[(index * 37) % Math.max(1, connectionPairs.length)];
      points.push(pair
        ? nodePositions[pair[0]]
        : new THREE.Vector3());
    }
    return points;
  }

  function createReferenceTraceLayout(THREE) {
    const segmentPoints = [];
    const junctions = [];
    const neuronPositions = [];
    const pulseRoutes = [];
    const circuitStrokePositions = [];

    function addPath(coordinates, z, includeBends = false) {
      const points = coordinates.map(([x, y]) => new THREE.Vector3(x, y, z));
      const segmentLengths = [];
      let totalLength = 0;
      neuronPositions.push(points[0]);
      for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const dz = end.z - start.z;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const subdivisions = Math.max(1, Math.ceil(length / 0.12));
        segmentLengths.push(length);
        totalLength += length;
        segmentPoints.push(start, end);
        if (includeBends) {
          const halfWidth = 0.006;
          const normalX = -(end.y - start.y) / length * halfWidth;
          const normalY = (end.x - start.x) / length * halfWidth;
          const startPlus = [start.x + normalX, start.y + normalY, z - 0.002];
          const startMinus = [start.x - normalX, start.y - normalY, z - 0.002];
          const endPlus = [end.x + normalX, end.y + normalY, z - 0.002];
          const endMinus = [end.x - normalX, end.y - normalY, z - 0.002];
          circuitStrokePositions.push(
            ...startPlus,
            ...startMinus,
            ...endMinus,
            ...startPlus,
            ...endMinus,
            ...endPlus
          );
        }
        for (let step = 1; step <= subdivisions; step += 1) {
          const progress = step / subdivisions;
          neuronPositions.push(new THREE.Vector3(
            start.x + dx * progress,
            start.y + dy * progress,
            start.z + dz * progress
          ));
        }
      }
      junctions.push(points[0]);
      if (includeBends) {
        junctions.push(...points.slice(1, -1));
      }
      junctions.push(points[points.length - 1]);
      pulseRoutes.push({
        phase: pulseRoutes.length * 0.137,
        points,
        segmentLengths,
        totalLength
      });
    }

    for (let lane = 0; lane < 3; lane += 1) {
      const centerY = (lane - 1) * 0.14;
      const coordinates = [];
      for (let index = 0; index <= 28; index += 1) {
        const progress = index / 28;
        coordinates.push([
          -1.24 + progress * 0.66,
          centerY + Math.sin(progress * Math.PI * 4 + lane * 0.72) * 0.052
        ]);
      }
      addPath(coordinates, -0.055);
    }

    const circuitPaths = Array.from({ length: 7 }, (_, lane) => {
      const y = 0.34 - lane * 0.12;
      return [[0.48, y], [0.68, y], [0.8, y + 0.04], [1.16, y + 0.04]];
    });
    for (const path of circuitPaths) {
      addPath(path, -0.045, true);
    }

    return {
      circuitStrokePositions: new Float32Array(circuitStrokePositions),
      junctions,
      neuronPositions,
      pulseRoutes,
      segmentPoints
    };
  }

  function updateReferenceTraceParticles(
    positionAttribute,
    pulseRoutes,
    count,
    elapsed,
    signalSpeed
  ) {
    if (!pulseRoutes.length) {
      return;
    }

    for (let index = 0; index < count; index += 1) {
      const routeIndex = index % pulseRoutes.length;
      const route = pulseRoutes[routeIndex];
      const routeParticle = Math.floor(index / pulseRoutes.length);
      const progress = (elapsed * signalSpeed * 0.22
        + route.phase + routeParticle * 0.5) % 1;
      let distance = progress * route.totalLength;
      let segmentIndex = 0;
      while (
        segmentIndex < route.segmentLengths.length - 1
        && distance > route.segmentLengths[segmentIndex]
      ) {
        distance -= route.segmentLengths[segmentIndex];
        segmentIndex += 1;
      }

      const start = route.points[segmentIndex];
      const end = route.points[segmentIndex + 1];
      const segmentLength = route.segmentLengths[segmentIndex];
      const segmentProgress = segmentLength > 0
        ? Math.min(1, distance / segmentLength)
        : 0;
      positionAttribute.setXYZ(
        index,
        start.x + (end.x - start.x) * segmentProgress,
        start.y + (end.y - start.y) * segmentProgress,
        start.z + (end.z - start.z) * segmentProgress
      );
    }
    positionAttribute.needsUpdate = true;
  }

  function createConnectionLinePoints(nodePositions, connectionPairs) {
    const points = [];
    for (const [start, end] of connectionPairs) {
      points.push(nodePositions[start], nodePositions[end]);
    }
    return points;
  }

  function createSignalRoutes(connectionPairs, nodeCount) {
    const adjacency = Array.from({ length: nodeCount }, () => []);
    connectionPairs.forEach(([start, end], edgeIndex) => {
      adjacency[start].push({ node: end, edgeIndex });
      adjacency[end].push({ node: start, edgeIndex });
    });

    const routes = [];
    for (let routeIndex = 0; routeIndex < performanceLimits.maxActivityPoints; routeIndex += 1) {
      let currentNode = (routeIndex * 137 + 23) % nodeCount;
      let previousNode = -1;
      const nodeIndices = [currentNode];
      const edgeIndices = [];
      const usedEdges = new Set();
      for (let step = 0; step < 8; step += 1) {
        const neighbors = adjacency[currentNode];
        const candidates = neighbors.filter(({ node, edgeIndex }) =>
          node !== previousNode && !usedEdges.has(edgeIndex)
        );
        const available = candidates.length ? candidates : neighbors;
        if (!available.length) {
          break;
        }
        const choice = available[(routeIndex * 11 + step * 7) % available.length];
        edgeIndices.push(choice.edgeIndex);
        usedEdges.add(choice.edgeIndex);
        previousNode = currentNode;
        currentNode = choice.node;
        nodeIndices.push(currentNode);
      }
      if (edgeIndices.length) {
        routes.push({
          edgeIndices,
          nodeIndices,
          phase: routeIndex * 0.43
        });
      }
    }
    return routes;
  }

  function updateNeuralNetwork(
    nodeAttribute,
    nodeColorAttribute,
    connectionAttribute,
    colorAttribute,
    nodePositions,
    connectionPairs,
    connectionWeights,
    animatedPositions,
    neuronActivity,
    connectionActivity,
    connectionSignalProgress,
    signalRoutes,
    config,
    elapsed
  ) {
    const motion = config.animated ? config.pulseAmount * 0.05 : 0;
    for (let index = 0; index < nodePositions.length; index += 1) {
      const base = nodePositions[index];
      const phase = elapsed * 1.1 + index * 0.19;
      const x = base.x + Math.sin(phase * 0.63) * motion * 0.65;
      const y = base.y + Math.sin(phase) * motion;
      const z = base.z + Math.cos(phase * 0.82) * motion * 0.8;
      const offset = index * 3;
      animatedPositions[offset] = x;
      animatedPositions[offset + 1] = y;
      animatedPositions[offset + 2] = z;
      nodeAttribute.setXYZ(index, x, y, z);

      const activationPhase = index * 2.399963229728653 + (index % 13) * 0.17;
      const oscillator = (Math.sin(elapsed * (0.72 + (index % 9) * 0.045)
        + activationPhase) + 1) * 0.5;
      const activationRange = Math.max(0.001, 1 - config.activationThreshold);
      const activation = config.animated
        ? Math.pow(Math.max(0, (oscillator - config.activationThreshold) / activationRange), 1.45)
          * config.neuronGain
        : 0;
      neuronActivity[index] = Math.min(1, config.neuronBaseline + activation);
      nodeColorAttribute.setXYZ(
        index,
        neuronActivity[index],
        neuronActivity[index],
        neuronActivity[index]
      );
    }
    nodeAttribute.needsUpdate = true;
    nodeColorAttribute.needsUpdate = true;

    connectionActivity.fill(0);
    connectionSignalProgress.fill(0);
    const routeCount = Math.min(config.activityPoints, signalRoutes.length);
    for (let routeIndex = 0; routeIndex < routeCount; routeIndex += 1) {
      const route = signalRoutes[routeIndex];
      const routePosition = (
        elapsed * config.signalSpeed + route.phase
      ) % route.edgeIndices.length;
      const edgeStep = Math.floor(routePosition);
      const progress = routePosition - edgeStep;
      const pulse = 0.64 + Math.sin(progress * Math.PI) * 0.36;
      const edgeIndex = route.edgeIndices[edgeStep];
      connectionActivity[edgeIndex] = Math.max(connectionActivity[edgeIndex], pulse);
      connectionSignalProgress[edgeIndex] = progress;

      if (edgeStep > 0) {
        const trailingEdge = route.edgeIndices[edgeStep - 1];
        const trailingPulse = (1 - progress) * 0.32;
        if (trailingPulse > connectionActivity[trailingEdge]) {
          connectionActivity[trailingEdge] = trailingPulse;
          connectionSignalProgress[trailingEdge] = 1;
        }
      }

      const startNode = route.nodeIndices[edgeStep];
      const endNode = route.nodeIndices[edgeStep + 1];
      neuronActivity[startNode] = Math.max(
        neuronActivity[startNode],
        0.48 + pulse * 0.46 * (1 - progress)
      );
      neuronActivity[endNode] = Math.max(
        neuronActivity[endNode],
        0.38 + pulse * 0.56 * progress
      );
    }
    for (let index = 0; index < nodePositions.length; index += 1) {
      const intensity = neuronActivity[index];
      nodeColorAttribute.setXYZ(index, intensity, intensity, intensity);
    }
    nodeColorAttribute.needsUpdate = true;

    const channels = [
      ((config.color >> 16) & 0xff) / 255,
      ((config.color >> 8) & 0xff) / 255,
      (config.color & 0xff) / 255
    ];
    for (let index = 0; index < connectionPairs.length; index += 1) {
      const [start, end] = connectionPairs[index];
      const startOffset = start * 3;
      const endOffset = end * 3;
      const vertexOffset = index * 2;
      connectionAttribute.setXYZ(
        vertexOffset,
        animatedPositions[startOffset],
        animatedPositions[startOffset + 1],
        animatedPositions[startOffset + 2]
      );
      connectionAttribute.setXYZ(
        vertexOffset + 1,
        animatedPositions[endOffset],
        animatedPositions[endOffset + 1],
        animatedPositions[endOffset + 2]
      );

      const weight = connectionWeights[index] || 1;
      const pulseBrightness = connectionActivity[index] * config.connectionPulseGain;
      const weightFactor = 0.35 + Math.min(1, weight) * 0.65;
      const inactiveBrightness = 0.008 + Math.min(1, weight) * 0.018;
      const progress = connectionSignalProgress[index];
      const startBrightness = inactiveBrightness
        + pulseBrightness * weightFactor * (0.3 + 0.7 * (1 - progress));
      const endBrightness = inactiveBrightness
        + pulseBrightness * weightFactor * (0.3 + 0.7 * progress);
      colorAttribute.setXYZ(
        vertexOffset,
        channels[0] * startBrightness,
        channels[1] * startBrightness,
        channels[2] * startBrightness
      );
      colorAttribute.setXYZ(
        vertexOffset + 1,
        channels[0] * endBrightness,
        channels[1] * endBrightness,
        channels[2] * endBrightness
      );
    }
    connectionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  }

  function updateEnergyParticles(
    geometry,
    connectionPairs,
    signalRoutes,
    animatedPositions,
    count,
    elapsed,
    config
  ) {
    if (!connectionPairs.length || typeof geometry.getAttribute !== "function") {
      return;
    }
    const positions = geometry.getAttribute("position");
    if (!positions || typeof positions.setXYZ !== "function") {
      return;
    }
    for (let index = 0; index < count; index += 1) {
      const route = signalRoutes[index];
      if (!route) {
        continue;
      }
      const routePosition = (
        elapsed * config.signalSpeed + route.phase
      ) % route.edgeIndices.length;
      const edgeStep = Math.floor(routePosition);
      const progress = routePosition - edgeStep;
      const pair = connectionPairs[route.edgeIndices[edgeStep]];
      const fromOffset = pair[0] * 3;
      const toOffset = pair[1] * 3;
      positions.setXYZ(
        index,
        animatedPositions[fromOffset]
          + (animatedPositions[toOffset] - animatedPositions[fromOffset]) * progress,
        animatedPositions[fromOffset + 1]
          + (animatedPositions[toOffset + 1] - animatedPositions[fromOffset + 1]) * progress,
        animatedPositions[fromOffset + 2]
          + (animatedPositions[toOffset + 2] - animatedPositions[fromOffset + 2]) * progress
      );
    }
    positions.needsUpdate = true;
  }

  function updateHotspotPositions(positionAttribute, animatedPositions, hotspotIndices) {
    for (let index = 0; index < hotspotIndices.length; index += 1) {
      const sourceOffset = hotspotIndices[index] * 3;
      positionAttribute.setXYZ(
        index,
        animatedPositions[sourceOffset],
        animatedPositions[sourceOffset + 1],
        animatedPositions[sourceOffset + 2]
      );
    }
    positionAttribute.needsUpdate = true;
  }

  function updateHotspotColors(colorAttribute, neuronActivity, hotspotIndices) {
    for (let index = 0; index < hotspotIndices.length; index += 1) {
      const intensity = Math.max(0, (neuronActivity[hotspotIndices[index]] - 0.035) * 1.5);
      colorAttribute.setXYZ(index, intensity, intensity, intensity);
    }
    colorAttribute.needsUpdate = true;
  }

  function pulseIntensity(config, elapsed, breath) {
    if (config.mode === "warning") {
      return (Math.sin(elapsed * 2.2) > 0.28 ? config.emissiveIntensity : 0.18);
    }
    return config.emissiveIntensity + Math.max(0, breath) * config.pulseAmount * 5;
  }

  function isMobileViewport(windowRef, container) {
    if (typeof windowRef.matchMedia === "function") {
      return windowRef.matchMedia("(max-width: 600px)").matches;
    }
    return (container.clientWidth || 0) <= 600;
  }

  function setMaterialColor(material, color) {
    if (material) {
      setColor(material.color, color);
      setColor(material.emissive, color);
      if (material.uniforms && material.uniforms.uColor) {
        setColor(material.uniforms.uColor.value, color);
      }
    }
  }

  function setColor(colorObject, color) {
    if (colorObject && typeof colorObject.setHex === "function") {
      colorObject.setHex(color);
    }
  }

  function trackGeometry(geometries, geometry) {
    geometries.add(geometry);
    return geometry;
  }

  function trackMaterial(materials, material) {
    materials.add(material);
    return material;
  }

  return {
    createAgentBrain,
    getPixelRatio,
    mapAgentStatus,
    performanceLimits,
    pulseIntensity,
    updateEnergyParticles,
    statusMap
  };
});
