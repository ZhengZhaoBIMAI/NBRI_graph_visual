const svg = document.querySelector("#graph");
const infoName = document.querySelector("#info-name");
const infoFields = document.querySelector("#info-fields");
const svgNamespace = "http://www.w3.org/2000/svg";

const nodes = window.nbriGraphData.nodes.map((node) => ({
  ...node,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  visible: true,
}));
const links = window.nbriGraphData.links.map((link) => ({ ...link }));

const nodeById = new Map(nodes.map((node) => [node.id, node]));
const researcherIds = new Set(
  nodes.filter((node) => node.kind === "researcher").map((node) => node.id),
);
links.forEach((link) => {
  link.sourceNode = nodeById.get(link.source);
  link.targetNode = nodeById.get(link.target);
});

let width = 0;
let height = 0;
let hoveredResearcher = null;
const lockedHoverLabPositions = new Map();
let hoveredNode = null;
let pinnedInfoNode = null;
const requestedFocus = new URLSearchParams(window.location.search).get("focus");
let pinnedResearcher = researcherIds.has(requestedFocus) ? requestedFocus : null;
let draggingNode = null;
let dragPointer = null;
let lastFrame = performance.now();

const layers = {
  links: makeSvg("g", { class: "links" }),
  labels: makeSvg("g", { class: "labels" }),
  nodes: makeSvg("g", { class: "nodes" }),
};

svg.append(layers.links, layers.labels, layers.nodes);

links.forEach((link) => {
  link.element = makeSvg("line", { class: `graph-link ${link.relation}` });
  link.labelElement = makeSvg("text", { class: "edge-label" });
  link.labelElement.textContent = link.label || "";
  layers.links.append(link.element);
  layers.labels.append(link.labelElement);
});

nodes.forEach((node) => {
  node.element = makeSvg("g", {
    class: `node ${node.kind}${node.detail ? " detail-node" : ""}`,
    tabindex: node.kind === "researcher" ? "0" : "-1",
    "aria-label": node.label.replaceAll("\n", " "),
  });
  node.circle = makeSvg("circle", { r: node.radius });
  node.text = makeSvg("text");
  writeNodeText(node);
  node.element.append(node.circle, node.text);
  layers.nodes.append(node.element);
  bindInfoEvents(node);

  if (node.kind === "researcher") {
    bindResearcherEvents(node.element, node.id);
  }

});

svg.addEventListener("pointermove", (event) => {
  if (draggingNode) {
    dragPointer = svgPoint(event);
  }
});

svg.addEventListener("pointerup", releaseDrag);
svg.addEventListener("pointercancel", releaseDrag);
svg.addEventListener("click", (event) => {
  if (event.target === svg) {
    pinnedResearcher = null;
    pinnedInfoNode = null;
    updateInfoCard();
  }
});

nodes
  .filter((node) => node.kind !== "root")
  .forEach((node) => {
    node.element.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      draggingNode = node;
      dragPointer = svgPoint(event);
      node.element.setPointerCapture(event.pointerId);
    });
  });

const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(svg);
resize();
requestAnimationFrame(startGraph);

function makeSvg(tag, attributes = {}) {
  const element = document.createElementNS(svgNamespace, tag);
  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, value);
  });
  return element;
}

function writeNodeText(node) {
  const lines = node.label.split("\n");
  const isExternalLabel = ["partner", "member", "collaborator", "workplace"].includes(
    node.kind,
  );
  const fontSize =
    node.kind === "root"
      ? 28
      : isExternalLabel
        ? 11
      : node.radius <= 35
        ? 11
        : node.radius <= 43
          ? 12
          : 14;

  node.text.setAttribute("font-size", fontSize);
  lines.forEach((line, index) => {
    const tspan = makeSvg(
      "tspan",
      isExternalLabel
        ? {
            x: "0",
            y: index === 0 ? `${node.radius + 18}` : null,
            dy: index === 0 ? "0" : "1.08em",
          }
        : {
            x: "0",
            dy: index === 0 ? `${-(lines.length - 1) * 0.54}em` : "1.08em",
          },
    );

    if (isExternalLabel && index > 0) {
      tspan.removeAttribute("y");
    }

    tspan.textContent = line;
    node.text.append(tspan);
  });

  if (node.kind === "researcher" && node.role) {
    const role = makeSvg("tspan", {
      x: "0",
      dy: "1.42em",
      class: "node-role",
    });
    role.textContent = node.role;
    node.text.append(role);
  }
}

function bindInfoEvents(node) {
  node.element.addEventListener("pointerenter", () => {
    hoveredNode = node.id;
    updateInfoCard();
  });
  node.element.addEventListener("pointerleave", () => {
    hoveredNode = null;
    updateInfoCard();
  });
  node.element.addEventListener("click", () => {
    pinnedInfoNode = node.id;
    updateInfoCard();
  });
  node.element.addEventListener("focus", () => {
    hoveredNode = node.id;
    updateInfoCard();
  });
  node.element.addEventListener("blur", () => {
    hoveredNode = null;
    updateInfoCard();
  });
}

function bindResearcherEvents(element, researcherId) {
  element.addEventListener("pointerenter", () => {
    hoveredResearcher = researcherId;
    lockHoveredLabPosition(researcherId);
  });
  element.addEventListener("pointerleave", () => {
    hoveredResearcher = null;
    lockedHoverLabPositions.delete(researcherId);
  });
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    pinnedResearcher = pinnedResearcher === researcherId ? null : researcherId;
  });
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    pinnedResearcher = pinnedResearcher === researcherId ? null : researcherId;
  });
}

function lockHoveredLabPosition(researcherId) {
  nodes
    .filter((node) => node.kind === "lab" && node.owner === researcherId)
    .forEach((node) => {
      const anchor = clampDetailAnchor(anchorFor(node, researcherId), node);
      lockedHoverLabPositions.set(node.id, anchor);
    });
}

function releaseDrag() {
  draggingNode = null;
  dragPointer = null;
}

function resize() {
  const bounds = svg.getBoundingClientRect();
  width = bounds.width;
  height = bounds.height;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const center = nodeById.get("nbri");
  center.x = width * 0.48;
  center.y = height * 0.51;
  center.vx = 0;
  center.vy = 0;

}

function seedPositions() {
  nodes.forEach((node, index) => {
    if (node.id === "nbri") {
      return;
    }

    const angle = node.angle ?? index * 0.62;
    const center = anchorFor(node);
    const distance = node.parent ? 118 : node.owner ? 126 : 245;
    node.x = center.x + Math.cos(angle) * distance;
    node.y = center.y + Math.sin(angle) * distance;
  });
}

function startGraph() {
  resize();
  seedPositions();
  updateInfoCard();
  requestAnimationFrame(tick);
}

function activeResearcher() {
  return pinnedResearcher || hoveredResearcher;
}

function updateInfoCard() {
  const node = nodeById.get(hoveredNode || pinnedInfoNode || "nbri");
  const info = node.info || {};
  const fields = [
    ["Hebrew Name", info.hebrewName],
    ["Affiliation", info.affiliation],
    ["Website", info.website],
  ].filter(([, value]) => value);

  infoName.textContent = info.name || node.label.replaceAll("\n", " ");
  infoFields.replaceChildren();

  fields.forEach(([label, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;

    if (label === "Website") {
      const link = document.createElement("a");
      link.href = value;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = value;
      description.append(link);
    } else {
      description.textContent = value;
    }

    row.append(term, description);
    infoFields.append(row);
  });
}

function tick(now) {
  const delta = Math.min((now - lastFrame) / 16.67, 2);
  lastFrame = now;
  simulate(delta);
  render();
  requestAnimationFrame(tick);
}

function simulate(delta) {
  const activeId = activeResearcher();
  const visibleNodes = nodes.filter((node) => nodeOpacity(node, activeId) > 0.03);

  visibleNodes.forEach((node) => {
    if (node.id === "nbri") {
      return;
    }

    const anchor = anchorFor(node, activeId);
    const anchorForce = node.owner
      ? node.detail && node.owner === activeId
        ? 0.026
        : 0.018
      : node.parent
        ? 0.024
        : 0.042;
    node.vx += (anchor.x - node.x) * anchorForce * delta;
    node.vy += (anchor.y - node.y) * anchorForce * delta;
  });

  for (let first = 0; first < visibleNodes.length; first += 1) {
    for (let second = first + 1; second < visibleNodes.length; second += 1) {
      if (visibleNodes[first].owner || visibleNodes[second].owner) {
        continue;
      }

      repel(visibleNodes[first], visibleNodes[second], delta);
    }
  }

  links.forEach((link) => {
    if (link.preview || link.detail || linkOpacity(link, activeId) <= 0.03) {
      return;
    }

    spring(link, delta);
  });

  avoidBaseLinkContacts(visibleNodes, activeId, delta);

  nodes.forEach((node) => {
    if (node.id === "nbri") {
      node.x = width * 0.48;
      node.y = height * 0.51;
      return;
    }

    if (node === draggingNode && dragPointer) {
      node.x = dragPointer.x;
      node.y = dragPointer.y;
      node.vx = 0;
      node.vy = 0;
      return;
    }

    if (node.owner) {
      const lockedLabPosition =
        node.kind === "lab" && node.owner === hoveredResearcher
          ? lockedHoverLabPositions.get(node.id)
          : null;
      if (lockedLabPosition) {
        node.x = lockedLabPosition.x;
        node.y = lockedLabPosition.y;
        node.vx = 0;
        node.vy = 0;
        return;
      }

      const localAnchor =
        node.kind === "preview" ? previewAnchorFor(node, activeId) : anchorFor(node, activeId);
      const safeAnchor = clampDetailAnchor(localAnchor, node);
      const followStrength = node.detail ? Math.min(0.34 * delta, 1) : 1;
      node.x += (safeAnchor.x - node.x) * followStrength;
      node.y += (safeAnchor.y - node.y) * followStrength;
      node.vx = 0;
      node.vy = 0;
      return;
    }

    node.vx *= 0.83;
    node.vy *= 0.83;
    node.x += node.vx * delta;
    node.y += node.vy * delta;
    const horizontalPadding =
      ["partner", "member", "collaborator", "workplace"].includes(node.kind)
        ? 52
        : node.radius + 18;
    node.x = clamp(node.x, horizontalPadding, width - horizontalPadding);
    node.y = clamp(node.y, node.radius + 18, height - node.radius - 18);
  });

}

function anchorFor(node, activeId = activeResearcher()) {
  const center = nodeById.get("nbri");

  if (node.parent) {
    const parent = nodeById.get(node.parent);
    const direction = ownerDirection(parent);
    return {
      x: parent.x + direction.x * (node.branchDistance || 214) + direction.normalX * (node.spread || 0),
      y: parent.y + direction.y * (node.branchDistance || 214) + direction.normalY * (node.spread || 0),
    };
  }

  if (node.owner) {
    const owner = nodeById.get(node.owner);
    const active = node.owner === activeId;
    const direction = ownerDirection(owner);

    if (node.kind === "member") {
      const labAnchor = anchorFor(detailParentFor(node, "lab"), activeId);
      return {
        x: labAnchor.x + direction.x * (node.branchDistance || 214) + direction.normalX * (node.spread || 0),
        y: labAnchor.y + direction.y * (node.branchDistance || 214) + direction.normalY * (node.spread || 0),
      };
    }

    if (node.kind === "collaborator") {
      return {
        x: owner.x + direction.x * (node.branchDistance || 224) + direction.normalX * (node.spread || 168),
        y: owner.y + direction.y * (node.branchDistance || 224) + direction.normalY * (node.spread || 168),
      };
    }

    if (node.kind === "workplace") {
      const collaboratorAnchor = anchorFor(detailParentFor(node, "collaborator"), activeId);
      const labNode = detailNodeFor(node.owner, "lab");
      const labAnchor = labNode ? anchorFor(labNode, activeId) : owner;
      const collaboratorDirection = pointDirection(labAnchor, collaboratorAnchor, direction);
      return {
        x: collaboratorAnchor.x + collaboratorDirection.x * (node.branchDistance || 128),
        y: collaboratorAnchor.y + collaboratorDirection.y * (node.branchDistance || 128),
      };
    }

    const distance = node.kind === "preview" ? 128 : active ? 152 : 120;
    return {
      x: owner.x + direction.x * distance,
      y: owner.y + direction.y * distance,
    };
  }

  const mainDistance = node.kind === "hub" ? Math.min(width, height) * 0.32 : 224;
  return {
    x: center.x + Math.cos(node.angle) * mainDistance,
    y: center.y + Math.sin(node.angle) * mainDistance,
  };
}

function ownerDirection(owner) {
  const center = nodeById.get("nbri");
  const dx = owner.x - center.x;
  const dy = owner.y - center.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: dx / length,
    y: dy / length,
    normalX: -dy / length,
    normalY: dx / length,
  };
}

function detailParentFor(node, kind) {
  const parentLink = links.find(
    (link) => link.target === node.id && link.sourceNode?.kind === kind,
  );
  return parentLink?.sourceNode || nodeById.get(node.owner);
}

function detailNodeFor(owner, kind) {
  return nodes.find((node) => node.owner === owner && node.kind === kind);
}

function pointDirection(from, to, fallback) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (!length) {
    return fallback;
  }

  return {
    x: dx / length,
    y: dy / length,
  };
}

function clampDetailAnchor(anchor, node) {
  const topPadding =
    node.kind === "workplace" ? 178 : node.detail ? 126 : node.radius + 18;
  return {
    x: clamp(anchor.x, node.radius + 24, width - node.radius - 24),
    y: clamp(anchor.y, topPadding, height - node.radius - 24),
  };
}

function previewAnchorFor(node, activeId) {
  const owner = nodeById.get(node.owner);
  const direction = ownerDirection(owner);
  const candidates = [
    { distance: 128, spread: 0 },
    { distance: 144, spread: -68 },
    { distance: 144, spread: 68 },
    { distance: 164, spread: -104 },
    { distance: 164, spread: 104 },
  ];

  for (const candidate of candidates) {
    const point = {
      x: owner.x + direction.x * candidate.distance + direction.normalX * candidate.spread,
      y: owner.y + direction.y * candidate.distance + direction.normalY * candidate.spread,
    };

    if (!overlapsBaseNode(point, node)) {
      return point;
    }
  }

  return anchorFor(node, activeId);
}

function overlapsBaseNode(point, node) {
  return nodes.some((other) => {
    if (other.id === node.id || other.owner) {
      return false;
    }

    const clearance = node.radius + other.radius + 26;
    return Math.hypot(point.x - other.x, point.y - other.y) < clearance;
  });
}

function repel(first, second, delta) {
  const dx = second.x - first.x || 0.01;
  const dy = second.y - first.y || 0.01;
  const distanceSquared = dx * dx + dy * dy;
  const distance = Math.sqrt(distanceSquared);
  const desired = first.radius + second.radius + 22;

  if (distance > desired * 3.2) {
    return;
  }

  const collisionBoost = distance < desired ? 2.4 : 0.34;
  const force = (desired * desired * collisionBoost) / Math.max(distanceSquared, 1800);
  const fx = (dx / distance) * force * delta;
  const fy = (dy / distance) * force * delta;

  if (first.id !== "nbri") {
    first.vx -= fx / (first.mass || 1);
    first.vy -= fy / (first.mass || 1);
  }
  if (second.id !== "nbri") {
    second.vx += fx / (second.mass || 1);
    second.vy += fy / (second.mass || 1);
  }
}

function avoidBaseLinkContacts(visibleNodes, activeId, delta) {
  const baseNodes = visibleNodes.filter((node) => !node.owner && node.id !== "nbri");

  baseNodes.forEach((node) => {
    links.forEach((link) => {
      if (
        link.preview ||
        link.detail ||
        linkOpacity(link, activeId) <= 0.03 ||
        link.source === node.id ||
        link.target === node.id
      ) {
        return;
      }

      const nearest = nearestPointOnLink(node, link);
      const dx = node.x - nearest.x || 0.01;
      const dy = node.y - nearest.y || 0.01;
      const distance = Math.hypot(dx, dy);
      const clearance = node.radius + 22;

      if (distance >= clearance) {
        return;
      }

      const force = ((clearance - distance) / clearance) * 1.25 * delta;
      node.vx += (dx / distance) * force;
      node.vy += (dy / distance) * force;
    });
  });
}

function nearestPointOnLink(node, link) {
  const source = link.sourceNode;
  const target = link.targetNode;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const lengthSquared = dx * dx + dy * dy || 1;
  const progress = clamp(
    ((node.x - source.x) * dx + (node.y - source.y) * dy) / lengthSquared,
    0,
    1,
  );

  return {
    x: source.x + dx * progress,
    y: source.y + dy * progress,
  };
}

function spring(link, delta) {
  const source = link.sourceNode;
  const target = link.targetNode;
  const dx = target.x - source.x || 0.01;
  const dy = target.y - source.y || 0.01;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const stretch = distance - link.distance;
  const force = stretch * link.strength * delta;
  const fx = (dx / distance) * force;
  const fy = (dy / distance) * force;

  if (source.id !== "nbri") {
    source.vx += fx / (source.mass || 1);
    source.vy += fy / (source.mass || 1);
  }
  if (target.id !== "nbri") {
    target.vx -= fx / (target.mass || 1);
    target.vy -= fy / (target.mass || 1);
  }
}

function render() {
  const activeId = activeResearcher();

  links.forEach((link) => {
    const opacity = linkOpacity(link, activeId);
    link.element.setAttribute("x1", link.sourceNode.x);
    link.element.setAttribute("y1", link.sourceNode.y);
    link.element.setAttribute("x2", link.targetNode.x);
    link.element.setAttribute("y2", link.targetNode.y);
    link.element.setAttribute("stroke-opacity", opacity);
    link.element.setAttribute("stroke-width", linkWidth(link, activeId));
    link.labelElement.setAttribute("x", (link.sourceNode.x + link.targetNode.x) / 2);
    link.labelElement.setAttribute("y", (link.sourceNode.y + link.targetNode.y) / 2 - 8);
    link.labelElement.setAttribute(
      "opacity",
      link.detail && link.owner === activeId ? "1" : "0",
    );
  });

  nodes.forEach((node) => {
    const opacity = nodeOpacity(node, activeId);
    const onFocusPath = nodeInFocusSubtree(node, activeId);

    node.element.setAttribute("transform", `translate(${node.x} ${node.y})`);
    node.element.style.opacity = opacity;
    const detailIsInteractive =
      (!node.detail && node.kind !== "preview") || node.owner === pinnedResearcher;
    node.element.style.pointerEvents =
      opacity > 0.12 && detailIsInteractive ? "auto" : "none";
    node.element.classList.toggle("active", Boolean(activeId && onFocusPath));
    node.element.classList.toggle(
      "dimmed",
      Boolean(activeId && !onFocusPath),
    );
  });
}

function nodeOpacity(node, activeId) {
  if (node.detail) {
    return node.owner === activeId ? 1 : 0;
  }

  if (node.kind === "preview") {
    return activeId ? 0 : 0.44;
  }

  return activeId && !nodeInFocusSubtree(node, activeId) ? 0.16 : 1;
}

function linkOpacity(link, activeId) {
  if (link.detail) {
    return link.owner === activeId ? 0.94 : 0;
  }

  if (link.preview) {
    return activeId ? 0 : 0.18;
  }

  return activeId && !linkInFocusSubtree(link, activeId) ? 0.12 : 0.8;
}

function linkWidth(link, activeId) {
  const isSecondaryLink = link.detail || link.targetNode?.parent;

  if (isSecondaryLink) {
    return 1.8;
  }

  if (
    activeId &&
    ((link.source === "nbri" && link.target === activeId) ||
      (link.target === "nbri" && link.source === activeId))
  ) {
    return 2.6;
  }

  return link.preview ? 1.5 : link.relation === "cooperate" ? 3 : 3.2;
}

function nodeInFocusSubtree(node, activeId) {
  return !activeId || node.id === "nbri" || node.id === activeId || node.owner === activeId;
}

function linkInFocusSubtree(link, activeId) {
  if (!activeId) {
    return true;
  }

  return (
    link.owner === activeId ||
    (link.source === "nbri" && link.target === activeId) ||
    (link.target === "nbri" && link.source === activeId)
  );
}

function svgPoint(event) {
  const bounds = svg.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
