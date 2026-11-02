const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const agentBrain = require("../js/agent-brain.js");

function createContainer() {
  return {
    attributes: {},
    dataset: {},
    innerHTML: "",
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
}

test("Agent Status maps known and unknown states to explicit circuit activity", () => {
  const expectedStates = {
    ACTIVE: { signalCount: 12, color: "#65dc92", signalDuration: 3.2 },
    ANALYZING: { signalCount: 24, color: "#9dffbd", signalDuration: 1.25 },
    IDLE: { signalCount: 2, color: "#67866f", signalDuration: 7.5 },
    STOPPED: { signalCount: 0, color: "#75808d", signalDuration: 0 },
    ERROR: { signalCount: 6, color: "#ff6478", signalDuration: 2.4 },
    UNKNOWN: { signalCount: 0, color: "#75808d", signalDuration: 0 }
  };

  for (const [status, expected] of Object.entries(expectedStates)) {
    const config = agentBrain.mapAgentStatus(status);
    assert.equal(config.status, status);
    assert.equal(config.signalCount, expected.signalCount);
    assert.equal(config.color, expected.color);
    assert.equal(config.signalDuration, expected.signalDuration);
  }
  assert.equal(agentBrain.mapAgentStatus("  analyzing ").status, "ANALYZING");
  assert.equal(agentBrain.mapAgentStatus("not-a-status").status, "UNKNOWN");
  assert.equal(agentBrain.mapAgentStatus(null).status, "UNKNOWN");
});

test("circuit SVG uses the green board and boundary-origin moving signals", () => {
  const container = createContainer();
  const stateElement = { dataset: {} };
  const circuit = agentBrain.createAgentBrain({
    container,
    stateElement,
    initialStatus: "ACTIVE"
  });

  assert.equal(circuit.available, true);
  assert.equal(circuit.isAvailable(), true);
  assert.equal(stateElement.dataset.state, "active");
  assert.equal(
    container.attributes["aria-label"],
    "Agent circuit visualization; status ACTIVE"
  );
  assert.match(container.innerHTML, /viewBox="0 0 1254 1254"/);
  assert.match(container.innerHTML, /class="circuit-board-image" href="\/assets\/agent-circuit-board\.png"/);
  assert.match(container.innerHTML, /class="circuit-chip-analyzing-glow"[^>]+filter="url\(#circuit-chip-analyzing-glow\)"/);
  assert.doesNotMatch(container.innerHTML, /<text\b|INPUT BUS|OUTPUT BUS|DATA BUS/);
  assert.match(container.innerHTML, /class="circuit-flow circuit-flow--analyzing"/);
  assert.match(container.innerHTML, /<animateMotion[^>]+path="M/);
  assert.match(container.innerHTML, /<animate attributeName="opacity" values="1;1;0" keyTimes="0;0\.72;1"/);
  assert.match(container.innerHTML, /class="circuit-neuron-halo" r="22"/);
  assert.match(container.innerHTML, /class="circuit-neuron-core" r="8"/);
  assert.equal(agentBrain.signalRoutes.length, 16);
  assert.match(container.innerHTML, /<mask id="circuit-trace-mask"[^>]+mask-type="luminance">/);
  assert.match(container.innerHTML, /mask="url\(#circuit-trace-mask\)"/);
  assert.doesNotMatch(container.innerHTML, /circuit-board-clip|clip-path=/);
  const circuitArtwork = fs.readFileSync(path.join(__dirname, "..", "assets", "agent-circuit-board.png"));
  assert.ok(circuitArtwork.length > 100000);
  assert.equal(circuitArtwork.readUInt32BE(16), 1254);
  assert.equal(circuitArtwork.readUInt32BE(20), 1254);
  const routeStarts = agentBrain.signalRoutes.map((route) => {
    const [, x, y] = route.match(/^M([\d.]+)\s([\d.]+)/);
    return { x: Number(x), y: Number(y) };
  });
  assert.ok(routeStarts.every(({ x, y }) => Math.max(Math.abs(x - 627), Math.abs(y - 627)) >= 100));
  const routeDirections = new Set(agentBrain.signalRoutes.map((route) => {
    const [, startX, startY] = route.match(/^M([\d.]+)\s([\d.]+)/);
    const endX = Number(route.match(/H([\d.]+)$/)?.[1] || startX);
    const endY = Number(route.match(/V([\d.]+)$/)?.[1] || startY);
    return Math.abs(endX - Number(startX)) > Math.abs(endY - Number(startY))
      ? (endX < Number(startX) ? "left" : "right")
      : (endY < Number(startY) ? "up" : "down");
  }));
  assert.deepEqual(routeDirections, new Set(["up", "down", "left", "right"]));
  for (const [status, expectedCount] of Object.entries({
    ACTIVE: 12,
    ANALYZING: 24,
    IDLE: 2,
    STOPPED: 0,
    ERROR: 6,
    UNKNOWN: 0
  })) {
    const statusClass = status.toLowerCase();
    assert.ok(container.innerHTML.includes(`class="circuit-flow circuit-flow--${statusClass}"`));
    const signalGroups = container.innerHTML.match(
      new RegExp(`<g class="circuit-neuron circuit-neuron--${statusClass}"`, "g")
    );
    assert.equal(signalGroups?.length || 0, expectedCount);
  }

  circuit.dispose();
});

test("status updates keep accessibility and activity state synchronized", () => {
  const container = createContainer();
  const stateElement = { dataset: {} };
  const circuit = agentBrain.createAgentBrain({ container, stateElement });

  const analyzing = circuit.setStatus("ANALYZING");
  assert.equal(analyzing.signalCount, 24);
  assert.equal(stateElement.dataset.state, "analyzing");
  assert.equal(
    container.attributes["aria-label"],
    "Agent circuit visualization; status ANALYZING"
  );

  const stopped = circuit.setStatus("STOPPED");
  assert.equal(stopped.signalCount, 0);
  assert.equal(stateElement.dataset.state, "stopped");
  assert.equal(
    container.attributes["aria-label"],
    "Agent circuit visualization; status STOPPED"
  );
  circuit.dispose();
});

test("circuit renderer handles missing containers and disposes safely", () => {
  const unavailable = agentBrain.createAgentBrain();
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.isAvailable(), false);

  const container = createContainer();
  const circuit = agentBrain.createAgentBrain({ container });
  circuit.dispose();
  circuit.dispose();
  assert.equal(circuit.isAvailable(), false);
  assert.equal(container.innerHTML, "");
  assert.throws(() => circuit.setStatus("ACTIVE"), /disposed Agent Status visualization/);
});

test("reduced-motion styling leaves the circuit static and visible", () => {
  const stylesPath = path.join(__dirname, "..", "css", "styles.css");
  const styles = fs.readFileSync(stylesPath, "utf8");
  const brainBlock = styles.match(/\.agent-brain\s*\{([\s\S]*?)\n\}/);
  const reducedMotionBlock = styles.match(
    /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
  );

  assert.ok(brainBlock);
  assert.match(brainBlock[1], /background:\s*transparent;/);
  assert.doesNotMatch(brainBlock[1], /border(?:-radius)?:/);
  assert.ok(reducedMotionBlock);
  assert.match(reducedMotionBlock[1], /\.circuit-flow\s*\{\s*display:\s*none\s*!important;/);
  assert.match(styles, /\.circuit-flow--analyzing/);
});

test("the base circuit glow is subdued so status neurons remain prominent", () => {
  const stylesPath = path.join(__dirname, "..", "css", "styles.css");
  const styles = fs.readFileSync(stylesPath, "utf8");
  const boardImage = styles.match(/\.circuit-board-image\s*\{([\s\S]*?)\n\}/);
  const signalHalo = styles.match(/\.circuit-neuron-halo\s*\{([\s\S]*?)\n\}/);
  const analyzingHalo = styles.match(/\.circuit-neuron--analyzing \.circuit-neuron-halo\s*\{([\s\S]*?)\n\}/);
  const errorHalo = styles.match(/\.circuit-neuron--error \.circuit-neuron-halo\s*\{([\s\S]*?)\n\}/);

  assert.ok(boardImage);
  assert.match(boardImage[1], /opacity:\s*0\.45;/);
  assert.ok(signalHalo);
  assert.match(signalHalo[1], /opacity:\s*1;/);
  assert.match(signalHalo[1], /drop-shadow\(0 0 12px #78ffad\)/);
  assert.ok(analyzingHalo);
  assert.match(analyzingHalo[1], /drop-shadow\(0 0 30px rgb\(75 255 145 \/ 98%\)\)/);
  assert.ok(errorHalo);
  assert.match(errorHalo[1], /drop-shadow\(0 0 24px rgb\(255 100 120 \/ 90%\)\)/);
});

test("ANALYZING adds a restrained chip glow while desktop keeps the circuit compact", () => {
  const stylesPath = path.join(__dirname, "..", "css", "styles.css");
  const styles = fs.readFileSync(stylesPath, "utf8");
  const desktopBlock = styles.match(/@media \(min-width: 900px\)\s*\{([\s\S]*?)\n\}/);
  const analyzingGlow = styles.match(
    /\.agent-brain\[data-state="analyzing"\] \.circuit-chip-analyzing-glow\s*\{([\s\S]*?)\n\}/
  );

  assert.ok(desktopBlock);
  assert.match(desktopBlock[1], /\.agent-brain-stage\s*\{\s*width:\s*min\(100%,\s*440px\);/);
  assert.ok(analyzingGlow);
  assert.match(analyzingGlow[1], /opacity:\s*0\.32;/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.circuit-chip-analyzing-glow\s*\{\s*transition:\s*none;/
  );
});
