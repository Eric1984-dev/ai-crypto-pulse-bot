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
    ACTIVE: { signalCount: 12, color: "#c780f0", signalDuration: 3.2 },
    ANALYZING: { signalCount: 24, color: "#ed9cff", signalDuration: 1.25 },
    IDLE: { signalCount: 2, color: "#8f76a1", signalDuration: 7.5 },
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

test("circuit SVG uses the purple board and boundary-origin moving signals", () => {
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
  assert.match(container.innerHTML, /viewBox="0 0 1000 1000"/);
  assert.match(container.innerHTML, /class="circuit-board-image" href="\/assets\/agent-circuit-board\.png"/);
  assert.doesNotMatch(container.innerHTML, /<text\b|INPUT BUS|OUTPUT BUS|DATA BUS/);
  assert.match(container.innerHTML, /class="circuit-flow circuit-flow--analyzing"/);
  assert.match(container.innerHTML, /<animateMotion[^>]+path="M/);
  assert.equal(agentBrain.signalRoutes.length, 52);
  assert.match(container.innerHTML, /clip-path="url\(#circuit-board-clip\)"/);
  assert.match(container.innerHTML, /<clipPath id="circuit-board-clip">\s*<rect x="22" y="22" width="956" height="956" rx="76"\/>/);
  assert.ok(fs.statSync(path.join(__dirname, "..", "assets", "agent-circuit-board.png")).size > 100000);
  const routeStarts = agentBrain.signalRoutes.map((route) => {
    const [, x, y] = route.match(/^M([\d.]+)\s([\d.]+)/);
    return { x: Number(x), y: Number(y) };
  });
  assert.ok(routeStarts.every(({ x, y }) => Math.max(Math.abs(x - 500), Math.abs(y - 500)) >= 130));
  assert.ok(agentBrain.signalRoutes.every((route) =>
    route.match(/[\d.]+/g).every((coordinate) => Number(coordinate) >= 22 && Number(coordinate) <= 978)
  ));
  assert.deepEqual(new Set(agentBrain.signalRoutes.map((route) => {
    if (route.endsWith("V36")) return "up";
    if (route.endsWith("V964")) return "down";
    if (route.endsWith("H36")) return "left";
    if (route.endsWith("H964")) return "right";
    return "diagonal";
  })), new Set(["up", "down", "left", "right", "diagonal"]));
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
  const reducedMotionBlock = styles.match(
    /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/
  );

  assert.ok(reducedMotionBlock);
  assert.match(reducedMotionBlock[1], /\.circuit-flow\s*\{\s*display:\s*none\s*!important;/);
  assert.match(styles, /\.circuit-flow--analyzing/);
});
