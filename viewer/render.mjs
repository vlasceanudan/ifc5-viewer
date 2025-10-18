// ifcx-core/layers/layer-providers.ts
var StackedLayerProvider = class {
  providers;
  constructor(providers) {
    this.providers = providers;
  }
  async GetLayerByURI(uri) {
    let errorStack = [];
    for (let provider of this.providers) {
      let layer = await provider.GetLayerByURI(uri);
      if (!(layer instanceof Error)) {
        return layer;
      } else {
        errorStack.push(layer);
      }
    }
    return new Error(JSON.stringify(errorStack));
  }
};
var InMemoryLayerProvider = class {
  layers;
  constructor() {
    this.layers = /* @__PURE__ */ new Map();
  }
  async GetLayerByURI(uri) {
    if (!this.layers.has(uri)) {
      return new Error(`File with uri "${uri}" not found`);
    }
    return this.layers.get(uri);
  }
  add(file) {
    if (this.layers.has(file.header.id)) {
      throw new Error(`Inserting file with duplicate ID "${file.header.id}"`);
    }
    this.layers.set(file.header.id, file);
    return this;
  }
  AddAll(files) {
    files.forEach((f) => this.add(f));
    return this;
  }
};

// ifcx-core/util/log.ts
var LOG_ENABLED = true;
function log(bla) {
  if (LOG_ENABLED) {
    console.log(`${JSON.stringify(arguments)}`);
  }
}

// local-import-map.ts
var LOCAL_IMPORT_MAP = {
  "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx": "deps/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx",
  "https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx": "deps/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx",
  "https://ifcx.dev/@standards.buildingsmart.org/ifc/ifc-infra/infra@v1.0.0.ifcx": "deps/@standards.buildingsmart.org/ifc/ifc-infra/infra@v1.0.0.ifcx",
  "https://ifcx.dev/@standards.buildingsmart.org/ifc/ifc-mat/ifc-mat@v1.0.0.ifcx": "deps/@standards.buildingsmart.org/ifc/ifc-mat/ifc-mat@v1.0.0.ifcx",
  "https://ifcx.dev/@standards.buildingsmart.org/ifc/ifc-mat/prop@v1.0.0.ifcx": "deps/@standards.buildingsmart.org/ifc/ifc-mat/prop@v1.0.0.ifcx",
  "https://ifcx.dev/@openusd.org/usd@v1.ifcx": "deps/@openusd.org/usd@v1.ifcx",
  "https://ifcx.dev/@nlsfb/nlsfb@v1.ifcx": "deps/@nlsfb/nlsfb@v1.ifcx"
};

// ifcx-core/layers/fetch-layer-provider.ts
function buildCandidateUrls(uri) {
  const candidates = [];
  const local = LOCAL_IMPORT_MAP[uri];
  if (local) {
    candidates.push(local);
  }
  candidates.push(uri);
  return candidates;
}
var FetchLayerProvider = class {
  layers;
  constructor() {
    this.layers = /* @__PURE__ */ new Map();
  }
  async FetchJson(url) {
    let result = await fetch(url);
    if (!result.ok) {
      return new Error(`Failed to fetch ${url}: ${result.status}`);
    }
    try {
      return await result.json();
    } catch (e) {
      log(url);
      return new Error(`Failed to parse json at ${url}: ${e}`);
    }
  }
  async GetLayerByURI(uri) {
    if (!this.layers.has(uri)) {
      for (const candidate of buildCandidateUrls(uri)) {
        const fetched = await this.FetchJson(candidate);
        if (fetched instanceof Error) {
          log(fetched.toString());
          continue;
        }
        let file = fetched;
        this.layers.set(uri, file);
        return file;
      }
      return new Error(`File with id "${uri}" not found`);
    }
    return this.layers.get(uri);
  }
};

// ifcx-core/util/mm.ts
function MMSet(map, key, value) {
  if (map.has(key)) {
    map.get(key)?.push(value);
  } else {
    map.set(key, [value]);
  }
}

// ifcx-core/composition/cycles.ts
var CycleError = class extends Error {
};
function FindRootsOrCycles(nodes) {
  let dependencies = /* @__PURE__ */ new Map();
  let dependents = /* @__PURE__ */ new Map();
  nodes.forEach((node, path) => {
    Object.keys(node.inherits).forEach((inheritName) => {
      MMSet(dependencies, path, node.inherits[inheritName]);
      MMSet(dependents, node.inherits[inheritName], path);
    });
    Object.keys(node.children).forEach((childName) => {
      MMSet(dependencies, path, node.children[childName]);
      MMSet(dependents, node.children[childName], path);
    });
  });
  let paths = [...nodes.keys()];
  let perm = {};
  let temp = {};
  function visit(path) {
    if (perm[path]) return;
    if (temp[path]) throw new Error(`CYCLE!`);
    temp[path] = true;
    let deps = dependencies.get(path);
    if (deps) {
      deps.forEach((dep) => visit(dep));
    }
    perm[path] = true;
  }
  let roots = /* @__PURE__ */ new Set();
  try {
    paths.forEach((path) => {
      if (!dependents.has(path) && path.indexOf("/") === -1) {
        roots.add(path);
      }
      visit(path);
    });
  } catch (e) {
    return null;
  }
  return roots;
}

// ifcx-core/composition/path.ts
function GetHead(path) {
  return path.split("/")[0];
}
function GetTail(path) {
  let parts = path.split("/");
  parts.shift();
  return parts.join("/");
}

// ifcx-core/composition/node.ts
function MakePostCompositionNode(node) {
  return {
    node,
    children: /* @__PURE__ */ new Map(),
    attributes: /* @__PURE__ */ new Map()
  };
}
function GetChildNodeWithPath(node, path) {
  if (path === "") return node;
  let parts = path.split("/");
  let child = node.children.get(parts[0]);
  if (child) {
    if (parts.length === 1) {
      return child;
    }
    return GetChildNodeWithPath(child, GetTail(path));
  } else {
    return null;
  }
}

// ifcx-core/composition/compose.ts
function FlattenPathToPreCompositionNode(path, inputNodes) {
  let compositionNode = {
    path,
    children: {},
    inherits: {},
    attributes: {}
  };
  inputNodes.forEach((node) => {
    Object.keys(node.children).forEach((childName) => {
      compositionNode.children[childName] = node.children[childName];
    });
    Object.keys(node.inherits).forEach((inheritName) => {
      let ih = node.inherits[inheritName];
      if (ih === null) {
        delete compositionNode.inherits[inheritName];
      } else {
        compositionNode.inherits[inheritName] = ih;
      }
    });
    Object.keys(node.attributes).forEach((attrName) => {
      compositionNode.attributes[attrName] = node.attributes[attrName];
    });
  });
  return compositionNode;
}
function FlattenCompositionInput(input) {
  let compositionNodes = /* @__PURE__ */ new Map();
  for (let [path, inputNodes] of input) {
    compositionNodes.set(path, FlattenPathToPreCompositionNode(path, inputNodes));
  }
  return compositionNodes;
}
function ExpandFirstRootInInput(nodes) {
  let roots = FindRootsOrCycles(nodes);
  if (!roots) {
    throw new CycleError();
  }
  return ComposeNodeFromPath([...roots.values()][0], nodes);
}
function CreateArtificialRoot(nodes) {
  let roots = FindRootsOrCycles(nodes);
  if (!roots) {
    throw new CycleError();
  }
  let pseudoRoot = {
    node: "",
    attributes: /* @__PURE__ */ new Map(),
    children: /* @__PURE__ */ new Map()
  };
  roots.forEach((root) => {
    pseudoRoot.children.set(root, ComposeNodeFromPath(root, nodes));
  });
  return pseudoRoot;
}
function ComposeNodeFromPath(path, preCompositionNodes) {
  return ComposeNode(path, MakePostCompositionNode(path), preCompositionNodes);
}
function ComposeNode(path, postCompositionNode, preCompositionNodes) {
  let preCompositionNode = preCompositionNodes.get(path);
  if (preCompositionNode) {
    AddDataFromPreComposition(preCompositionNode, postCompositionNode, preCompositionNodes);
  }
  postCompositionNode.children.forEach((child, name) => {
    ComposeNode(`${path}/${name}`, child, preCompositionNodes);
  });
  return postCompositionNode;
}
function AddDataFromPreComposition(input, node, nodes) {
  Object.values(input.inherits).forEach((inheritPath) => {
    let classNode = ComposeNodeFromPath(GetHead(inheritPath), nodes);
    let subnode = GetChildNodeWithPath(classNode, GetTail(inheritPath));
    if (!subnode) throw new Error(`Unknown node ${inheritPath}`);
    subnode.children.forEach((child, childName) => {
      node.children.set(childName, child);
    });
    for (let [attrID, attr] of subnode.attributes) {
      node.attributes.set(attrID, attr);
    }
  });
  Object.entries(input.children).forEach(([childName, child]) => {
    if (child !== null) {
      let classNode = ComposeNodeFromPath(GetHead(child), nodes);
      let subnode = GetChildNodeWithPath(classNode, GetTail(child));
      if (!subnode) throw new Error(`Unknown node ${child}`);
      node.children.set(childName, subnode);
    } else {
      node.children.delete(childName);
    }
  });
  Object.entries(input.attributes).forEach(([attrID, attr]) => {
    node.attributes.set(attrID, attr);
  });
}

// ifcx-core/schema/schema-validation.ts
var SchemaValidationError = class extends Error {
};
function ValidateAttributeValue(desc, value, path, schemas) {
  if (desc.optional && value === void 0) {
    return;
  }
  if (desc.inherits) {
    desc.inherits.forEach((inheritedSchemaID) => {
      let inheritedSchema = schemas[inheritedSchemaID];
      if (!inheritedSchema) {
        throw new SchemaValidationError(`Unknown inherited schema id "${desc.inherits}"`);
      }
      ValidateAttributeValue(inheritedSchema.value, value, path, schemas);
    });
  }
  if (desc.dataType === "Boolean") {
    if (typeof value !== "boolean") {
      throw new SchemaValidationError(`Expected "${value}" to be of type boolean`);
    }
  } else if (desc.dataType === "String") {
    if (typeof value !== "string") {
      throw new SchemaValidationError(`Expected "${value}" to be of type string`);
    }
  } else if (desc.dataType === "DateTime") {
    if (typeof value !== "string") {
      throw new SchemaValidationError(`Expected "${value}" to be of type date`);
    }
  } else if (desc.dataType === "Enum") {
    if (typeof value !== "string") {
      throw new SchemaValidationError(`Expected "${value}" to be of type string`);
    }
    let found = desc.enumRestrictions.options.filter((option) => option === value).length === 1;
    if (!found) {
      throw new SchemaValidationError(`Expected "${value}" to be one of [${desc.enumRestrictions.options.join(",")}]`);
    }
  } else if (desc.dataType === "Integer") {
    if (typeof value !== "number") {
      throw new SchemaValidationError(`Expected "${value}" to be of type int`);
    }
  } else if (desc.dataType === "Real") {
    if (typeof value !== "number") {
      throw new SchemaValidationError(`Expected "${value}" to be of type real`);
    }
  } else if (desc.dataType === "Reference") {
    if (typeof value !== "string") {
      throw new SchemaValidationError(`Expected "${value}" to be of type string`);
    }
  } else if (desc.dataType === "Object") {
    if (typeof value !== "object") {
      throw new SchemaValidationError(`Expected "${value}" to be of type object`);
    }
    if (desc.objectRestrictions) {
      Object.keys(desc.objectRestrictions.values).forEach((key) => {
        let optional = desc.objectRestrictions.values[key].optional;
        let hasOwn = Object.hasOwn(value, key);
        if (optional && !hasOwn) return;
        if (!hasOwn) {
          throw new SchemaValidationError(`Expected "${value}" to have key ${key}`);
        }
        ValidateAttributeValue(desc.objectRestrictions.values[key], value[key], path + "." + key, schemas);
      });
    }
  } else if (desc.dataType === "Array") {
    if (!Array.isArray(value)) {
      throw new SchemaValidationError(`Expected "${value}" to be of type array`);
    }
    value.forEach((entry) => {
      ValidateAttributeValue(desc.arrayRestrictions.value, entry, path + ".<array>.", schemas);
    });
  } else {
    throw new SchemaValidationError(`Unexpected datatype ${desc.dataType}`);
  }
}
function Validate(schemas, inputNodes) {
  inputNodes.forEach((node) => {
    Object.keys(node.attributes).filter((v) => !v.startsWith("__internal")).forEach((schemaID) => {
      if (!schemas[schemaID]) {
        throw new SchemaValidationError(`Missing schema "${schemaID}" referenced by ["${node.path}"].attributes`);
      }
      let schema = schemas[schemaID];
      let value = node.attributes[schemaID];
      try {
        ValidateAttributeValue(schema.value, value, "", schemas);
      } catch (e) {
        if (e instanceof SchemaValidationError) {
          throw new SchemaValidationError(`Error validating ["${node.path}"].attributes["${schemaID}"]: ${e.message}`);
        } else {
          throw e;
        }
      }
    });
  });
}

// ifcx-core/workflows.ts
function ToInputNodes(data) {
  let inputNodes = /* @__PURE__ */ new Map();
  data.forEach((ifcxNode) => {
    let node = {
      path: ifcxNode.path,
      children: ifcxNode.children ? ifcxNode.children : {},
      inherits: ifcxNode.inherits ? ifcxNode.inherits : {},
      attributes: ifcxNode.attributes ? ifcxNode.attributes : {}
    };
    MMSet(inputNodes, node.path, node);
  });
  return inputNodes;
}
function LoadIfcxFile(file, checkSchemas = true, createArtificialRoot = true) {
  let inputNodes = ToInputNodes(file.data);
  let compositionNodes = FlattenCompositionInput(inputNodes);
  try {
    if (checkSchemas) {
      Validate(file.schemas, compositionNodes);
    }
  } catch (e) {
    throw e;
  }
  if (createArtificialRoot) {
    return CreateArtificialRoot(compositionNodes);
  } else {
    return ExpandFirstRootInInput(compositionNodes);
  }
}
function Federate(files) {
  if (files.length === 0) {
    throw new Error(`Trying to federate empty set of files`);
  }
  let result = {
    header: files[0].header,
    imports: [],
    schemas: {},
    data: []
  };
  files.forEach((file) => {
    Object.keys(file.schemas).forEach((schemaID) => result.schemas[schemaID] = file.schemas[schemaID]);
  });
  files.forEach((file) => {
    file.data.forEach((node) => result.data.push(node));
  });
  return Prune(result);
}
function Collapse(nodes, deleteEmpty = false) {
  let result = {
    path: nodes[0].path,
    children: {},
    inherits: {},
    attributes: {}
  };
  nodes.forEach((node) => {
    Object.keys(node.children).forEach((name) => {
      result.children[name] = node.children[name];
    });
    Object.keys(node.inherits).forEach((name) => {
      result.inherits[name] = node.inherits[name];
    });
    Object.keys(node.attributes).forEach((name) => {
      result.attributes[name] = node.attributes[name];
    });
  });
  if (deleteEmpty) {
    let empty = true;
    Object.keys(result.children).forEach((name) => {
      if (result.children[name] !== null) empty = false;
    });
    Object.keys(result.inherits).forEach((name) => {
      if (result.inherits[name] !== null) empty = false;
    });
    Object.keys(result.attributes).forEach((name) => {
      if (result.attributes[name] !== null) empty = false;
    });
    if (empty) return null;
  }
  return result;
}
function Prune(file, deleteEmpty = false) {
  let result = {
    header: file.header,
    imports: [],
    schemas: file.schemas,
    data: []
  };
  let inputNodes = ToInputNodes(file.data);
  inputNodes.forEach((nodes) => {
    let collapsed = Collapse(nodes, deleteEmpty);
    if (collapsed) result.data.push({
      path: collapsed.path,
      children: collapsed.children,
      inherits: collapsed.inherits,
      attributes: collapsed.attributes
    });
  });
  return result;
}

// ifcx-core/layers/layer-stack.ts
var IfcxLayerStack = class {
  // main layer at 0
  layers;
  tree;
  schemas;
  federated;
  constructor(layers) {
    this.layers = layers;
    this.Compose();
  }
  GetLayerIds() {
    return this.layers.map((l) => l.header.id);
  }
  Compose() {
    this.federated = Federate(this.layers);
    this.schemas = this.federated.schemas;
    this.tree = LoadIfcxFile(this.federated);
  }
  GetFullTree() {
    this.Compose();
    return this.tree;
  }
  GetFederatedLayer() {
    return this.federated;
  }
  GetSchemas() {
    return this.schemas;
  }
};
var IfcxLayerStackBuilder = class {
  provider;
  mainLayerId = null;
  constructor(provider) {
    this.provider = provider;
  }
  FromId(id) {
    this.mainLayerId = id;
    return this;
  }
  async Build() {
    if (!this.mainLayerId) throw new Error(`no main layer ID specified`);
    let layers = await this.BuildLayerSet(this.mainLayerId);
    if (layers instanceof Error) {
      return layers;
    }
    try {
      return new IfcxLayerStack(layers);
    } catch (e) {
      return e;
    }
  }
  async SatisfyDependencies(activeLayer, placed, orderedLayers) {
    let pending = [];
    for (const impt of activeLayer.imports) {
      if (!placed.has(impt.uri)) {
        let layer = await this.provider.GetLayerByURI(impt.uri);
        if (layer instanceof Error) {
          return layer;
        }
        pending.push(layer);
        placed.set(impt.uri, true);
      }
    }
    let temp = [];
    for (const layer of pending) {
      temp.push(layer);
      let layers = await this.SatisfyDependencies(layer, placed, orderedLayers);
      if (layers instanceof Error) {
        return layers;
      }
      temp.push(...layers);
    }
    temp.forEach((t) => orderedLayers.push(t));
    return temp;
  }
  async BuildLayerSet(activeLayerID) {
    let activeLayer = await this.provider.GetLayerByURI(activeLayerID);
    if (activeLayer instanceof Error) {
      return activeLayer;
    }
    let layerSet = [activeLayer];
    let placed = /* @__PURE__ */ new Map();
    placed.set(activeLayer.header.id, true);
    let result = await this.SatisfyDependencies(activeLayer, placed, layerSet);
    if (result instanceof Error) {
      return result;
    }
    return layerSet;
  }
};

// viewer/compose-flattened.ts
function TreeNodeToComposedObject(path, node, schemas) {
  let co = {
    name: path,
    attributes: {},
    children: []
  };
  node.children.forEach((childNode, childName) => {
    co.children?.push(TreeNodeToComposedObject(`${path}/${childName}`, childNode, schemas));
  });
  node.attributes.forEach((attr, attrName) => {
    if (attr && typeof attr === "object" && !Array.isArray(attr)) {
      Object.keys(attr).forEach((compname) => {
        co.attributes[`${attrName}::${compname}`] = attr[compname];
      });
    } else {
      let schema = schemas[attrName];
      if (schema && schema.value.quantityKind) {
        let postfix = "";
        let quantityKind = schema.value.quantityKind;
        if (quantityKind === "Length") {
          postfix = "m";
        } else if (quantityKind === "Volume") {
          postfix = "m" + String.fromCodePoint(179);
        }
        co.attributes[attrName] = `${attr} ${postfix}`;
      } else {
        co.attributes[attrName] = attr;
      }
    }
  });
  if (Object.keys(co.attributes).length === 0) delete co.attributes;
  return co;
}
async function compose3(files) {
  let userDefinedOrder = {
    header: { ...files[0].header },
    imports: files.map((f) => {
      return { uri: f.header.id };
    }),
    schemas: {},
    data: []
  };
  userDefinedOrder.header.id = "USER_DEF";
  let provider = new StackedLayerProvider([
    new InMemoryLayerProvider().AddAll([userDefinedOrder, ...files]),
    new FetchLayerProvider()
  ]);
  let layerStack = await new IfcxLayerStackBuilder(provider).FromId(userDefinedOrder.header.id).Build();
  if (layerStack instanceof Error) {
    throw layerStack;
  }
  layerStack.GetFederatedLayer().data.forEach((n, i) => {
    n.attributes = n.attributes || {};
    n.attributes[`__internal_${i}`] = n.path;
  });
  return TreeNodeToComposedObject("", layerStack.GetFullTree(), layerStack.GetSchemas());
}

// viewer/render.ts
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { PCDLoader } from "three/addons/loaders/PCDLoader.js";
var controls;
var renderer;
var scene;
var camera;
var datas = [];
var autoCamera = true;
var objectMap = {};
var domMap = {};
var primMap = {};
var checkboxMap = {};
var currentPathMapping = null;
var rootPrim = null;
var selectedObject = null;
var selectedDom = null;
var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();
var envMap;
async function init() {
  scene = new THREE.Scene();
  const ambient = new THREE.AmbientLight(14544639, 0.4);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(16777215, 1);
  keyLight.position.set(5, -10, 7.5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(16777215, 0.5);
  fillLight.position.set(-5, 5, 5);
  scene.add(fillLight);
  const rimLight = new THREE.DirectionalLight(16777215, 0.3);
  rimLight.position.set(0, 8, -10);
  scene.add(rimLight);
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(50, 50, 50);
  camera.lookAt(0, 0, 0);
  const nd = document.querySelector(".viewport");
  renderer = new THREE.WebGLRenderer({
    alpha: true,
    logarithmicDepthBuffer: true
  });
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  new RGBELoader().load("images/wildflower_field_1k.hdr", function(texture) {
    envMap = pmremGenerator.fromEquirectangular(texture).texture;
    scene.environment = envMap;
    texture.dispose();
    pmremGenerator.dispose();
  });
  renderer.setSize(nd.offsetWidth, nd.offsetHeight);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.25;
  nd.appendChild(renderer.domElement);
  renderer.domElement.addEventListener("click", onCanvasClick);
  return scene;
}
function HasAttr(node, attrName) {
  if (!node || !node.attributes) return false;
  return !!node.attributes[attrName];
}
function setHighlight(obj, highlight) {
  if (!obj) return;
  obj.traverse((o) => {
    const mat = o.material;
    if (mat && mat.color) {
      if (highlight) {
        if (!o.userData._origColor) {
          o.userData._origColor = mat.color.clone();
        }
        o.material = mat.clone();
        o.material.color.set(16711680);
      } else if (o.userData._origColor) {
        mat.color.copy(o.userData._origColor);
        delete o.userData._origColor;
      }
    }
  });
}
function expandAncestors(node) {
  let current = node;
  while (current) {
    if (current.classList.contains("tree-node")) {
      const toggle = current.querySelector(":scope > .tree-node-header .tree-node-toggle");
      const children = current.querySelector(":scope > .tree-node-children");
      if (children && children.classList.contains("collapsed")) {
        children.classList.remove("collapsed");
        if (toggle && !toggle.classList.contains("is-leaf")) {
          toggle.classList.add("expanded");
          toggle.innerHTML = '<span class="material-symbols-outlined">expand_more</span>';
        }
      }
    }
    const parentChildren = current.parentElement;
    if (!parentChildren) {
      break;
    }
    if (parentChildren.classList.contains("tree-node-children")) {
      current = parentChildren.parentElement;
    } else {
      current = parentChildren;
    }
  }
}
function selectPath(path) {
  if (!path) {
    if (selectedObject) setHighlight(selectedObject, false);
    if (selectedDom) selectedDom.classList.remove("selected");
    selectedObject = null;
    selectedDom = null;
    return;
  }
  if (selectedObject) {
    setHighlight(selectedObject, false);
  }
  if (selectedDom) {
    selectedDom.classList.remove("selected");
  }
  selectedObject = objectMap[path] || null;
  selectedDom = domMap[path] || null;
  if (selectedObject) setHighlight(selectedObject, true);
  if (selectedDom) selectedDom.classList.add("selected");
  expandAncestors(selectedDom);
}
function onCanvasClick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = (event.clientX - rect.left) / rect.width * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(Object.values(objectMap), true);
  if (intersects.length > 0) {
    let obj = intersects[0].object;
    while (obj && !obj.userData.path) obj = obj.parent;
    if (obj && obj.userData.path) {
      const path = obj.userData.path;
      const prim = primMap[path];
      if (prim) {
        handleClick(prim, currentPathMapping, rootPrim || prim);
      }
      selectPath(path);
    }
  } else {
    selectPath(null);
  }
}
function tryCreateMeshGltfMaterial(path) {
  for (let p of path) {
    if (!p.attributes) {
      continue;
    }
    const pbrMetallicRoughness = p.attributes["gltf::material::pbrMetallicRoughness"];
    const normalTexture = p.attributes["gltf::material::normalTexture"];
    const occlusionTexture = p.attributes["gltf::material::occlusionTexture"];
    const emissiveTexture = p.attributes["gltf::material::emissiveTexture"];
    const emissiveFactor = p.attributes["gltf::material::emissiveFactor"];
    const alphaMode = p.attributes["gltf::material::alphaMode"];
    const alphaCutoff = p.attributes["gltf::material::alphaCutoff"];
    const doubleSided = p.attributes["gltf::material::doubleSided"];
    if (!pbrMetallicRoughness && !normalTexture && !occlusionTexture && !emissiveTexture && !emissiveFactor && !alphaMode && !alphaCutoff && !doubleSided) {
      continue;
    }
    let material = new THREE.MeshStandardMaterial();
    material.color = new THREE.Color(1, 1, 1);
    material.metalness = 1;
    material.roughness = 1;
    if (pbrMetallicRoughness) {
      let baseColorFactor = pbrMetallicRoughness["baseColorFactor"];
      if (baseColorFactor) {
        material.color = new THREE.Color(baseColorFactor[0], baseColorFactor[1], baseColorFactor[2]);
      }
      let metallicFactor = pbrMetallicRoughness["metallicFactor"];
      if (metallicFactor !== void 0) {
        material.metalness = metallicFactor;
      }
      let roughnessFactor = pbrMetallicRoughness["roughnessFactor"];
      if (roughnessFactor !== void 0) {
        material.roughness = roughnessFactor;
      }
    }
    material.envMap = envMap;
    material.needsUpdate = true;
    material.envMapRotation = new THREE.Euler(0.5 * Math.PI, 0, 0);
    return material;
  }
  return void 0;
}
function createMaterialFromParent(path) {
  let material = {
    color: new THREE.Color(0.6, 0.6, 0.6),
    transparent: false,
    opacity: 1
  };
  for (let p of path) {
    const color = p.attributes ? p.attributes["bsi::ifc::presentation::diffuseColor"] : null;
    if (color) {
      material.color = new THREE.Color(...color);
      const opacity = p.attributes["bsi::ifc::presentation::opacity"];
      if (opacity) {
        material.transparent = true;
        material.opacity = opacity;
      }
      break;
    }
  }
  return material;
}
function createCurveFromJson(path) {
  let points = new Float32Array(path[0].attributes["usd::usdgeom::basiscurves::points"].flat());
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  const material = createMaterialFromParent(path);
  let lineMaterial = new THREE.LineBasicMaterial({ ...material });
  lineMaterial.color.multiplyScalar(0.8);
  return new THREE.Line(geometry, lineMaterial);
}
function createMeshFromJson(path) {
  let points = new Float32Array(path[0].attributes["usd::usdgeom::mesh::points"].flat());
  let indices = new Uint16Array(path[0].attributes["usd::usdgeom::mesh::faceVertexIndices"]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  var meshMaterial;
  let gltfPbrMaterial = tryCreateMeshGltfMaterial(path);
  if (gltfPbrMaterial) {
    meshMaterial = gltfPbrMaterial;
  } else {
    const m = createMaterialFromParent(path);
    meshMaterial = new THREE.MeshLambertMaterial({ ...m });
  }
  return new THREE.Mesh(geometry, meshMaterial);
}
function createPointsFromJsonPcdBase64(path) {
  const base64_string = path[0].attributes["pcd::base64"];
  const decoded = atob(base64_string);
  const len = decoded.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = decoded.charCodeAt(i);
  }
  const loader = new PCDLoader();
  const points = loader.parse(bytes.buffer);
  points.material.sizeAttenuation = false;
  points.material.size = 2;
  return points;
}
function createPoints(geometry, withColors) {
  const material = new THREE.PointsMaterial();
  material.sizeAttenuation = false;
  material.fog = true;
  material.size = 5;
  material.color = new THREE.Color(withColors ? 16777215 : 0);
  if (withColors) {
    material.vertexColors = true;
  }
  return new THREE.Points(geometry, material);
}
function createPointsFromJsonArray(path) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(path[0].attributes["points::array::positions"].flat());
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const colors = path[0].attributes["points::array::colors"];
  if (colors) {
    const colors_ = new Float32Array(colors.flat());
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors_, 3));
  }
  return createPoints(geometry, colors);
}
function base64ToArrayBuffer(str) {
  let binary;
  try {
    binary = atob(str);
  } catch (e) {
    throw new Error("base64 encoded string is invalid");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; ++i) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
function createPointsFromJsonPositionBase64(path) {
  const geometry = new THREE.BufferGeometry();
  const positions_base64 = path[0].attributes["points::base64::positions"];
  const positions_bytes = base64ToArrayBuffer(positions_base64);
  if (!positions_bytes) {
    return null;
  }
  const positions = new Float32Array(positions_bytes);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const colors_base64 = path[0].attributes["points::base64::colors"];
  if (colors_base64) {
    const colors_bytes = base64ToArrayBuffer(colors_base64);
    if (colors_bytes) {
      const colors = new Float32Array(colors_bytes);
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    }
  }
  return createPoints(geometry, colors_base64);
}
function traverseTree(path, parent, pathMapping) {
  const node = path[0];
  let elem = new THREE.Group();
  if (HasAttr(node, "usd::usdgeom::visibility::visibility")) {
    if (node.attributes["usd::usdgeom::visibility::visibility"] === "invisible") {
      return;
    }
  } else if (HasAttr(node, "usd::usdgeom::mesh::points")) {
    elem = createMeshFromJson(path);
  } else if (HasAttr(node, "usd::usdgeom::basiscurves::points")) {
    elem = createCurveFromJson(path);
  } else if (HasAttr(node, "pcd::base64")) {
    elem = createPointsFromJsonPcdBase64(path);
  } else if (HasAttr(node, "points::array::positions")) {
    elem = createPointsFromJsonArray(path);
  } else if (HasAttr(node, "points::base64::positions")) {
    elem = createPointsFromJsonPositionBase64(path);
  }
  objectMap[node.name] = elem;
  primMap[node.name] = node;
  elem.userData.path = node.name;
  for (let path2 of Object.entries(node.attributes || {}).filter(([k, _]) => k.startsWith("__internal_")).map(([_, v]) => v)) {
    (pathMapping[String(path2)] = pathMapping[String(path2)] || []).push(node.name);
  }
  parent.add(elem);
  if (path.length > 1) {
    elem.matrixAutoUpdate = false;
    let matrixNode = node.attributes && node.attributes["usd::xformop::transform"] ? node.attributes["usd::xformop::transform"].flat() : null;
    if (matrixNode) {
      let matrix = new THREE.Matrix4();
      matrix.set(...matrixNode);
      matrix.transpose();
      elem.matrix = matrix;
    }
  }
  (node.children || []).forEach((child) => traverseTree([child, ...path], elem || parent, pathMapping));
}
function encodeHtmlEntities(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
var icons = {
  "usd::usdgeom::mesh::points": "deployed_code",
  "usd::usdgeom::basiscurves::points": "line_curve",
  "usd::usdshade::material::outputs::surface.connect": "line_style",
  "pcd::base64": "grain",
  "points::array::positions": "grain",
  "points::base64::positions": "grain"
};
function setVisibilityForPrim(prim, visible) {
  if (!prim) {
    return;
  }
  const stack = [prim];
  while (stack.length > 0) {
    const current = stack.pop();
    const obj = objectMap[current.name];
    if (obj) {
      obj.visible = visible;
    }
    const checkbox = checkboxMap[current.name];
    if (checkbox && checkbox.checked !== visible) {
      checkbox.checked = visible;
    }
    if (!visible && selectedDom && selectedDom.dataset && selectedDom.dataset.path === current.name) {
      selectPath(null);
    }
    (current.children || []).forEach((child) => stack.push(child));
  }
}
function handleClick(prim, pathMapping, root) {
  const container = document.querySelector(".attributes .table");
  if (container !== null) {
    container.innerHTML = "";
    const table = document.createElement("table");
    table.setAttribute("border", "0");
    const entries = [["name", prim.name], ...Object.entries(prim.attributes).filter(([k, _]) => !k.startsWith("__internal_"))];
    const format = (value) => {
      if (Array.isArray(value)) {
        let N = document.createElement("span");
        N.appendChild(document.createTextNode("("));
        let first = true;
        for (let n of value.map(format)) {
          if (!first) {
            N.appendChild(document.createTextNode(","));
          }
          N.appendChild(n);
          first = false;
        }
        N.appendChild(document.createTextNode(")"));
        return N;
      } else if (typeof value === "object") {
        const ks = Object.keys(value);
        if (ks.length == 1 && ks[0] === "ref" && pathMapping[value.ref] && pathMapping[value.ref].length == 1) {
          let a = document.createElement("a");
          let resolvedRefAsPath = pathMapping[value.ref][0];
          a.setAttribute("href", "#");
          a.textContent = resolvedRefAsPath;
          a.onclick = () => {
            let prim2 = null;
            const recurse = (n) => {
              if (n.name === resolvedRefAsPath) {
                prim2 = n;
              } else {
                (n.children || []).forEach(recurse);
              }
            };
            recurse(root);
            if (prim2) {
              handleClick(prim2, pathMapping, root);
            }
          };
          return a;
        } else {
          return document.createTextNode(JSON.stringify(value));
        }
      } else {
        return document.createTextNode(value);
      }
    };
    entries.forEach(([key, value]) => {
      const tr = document.createElement("tr");
      const tdKey = document.createElement("td");
      tdKey.textContent = encodeHtmlEntities(key);
      const tdValue = document.createElement("td");
      tdValue.appendChild(format(value));
      tr.appendChild(tdKey);
      tr.appendChild(tdValue);
      table.appendChild(tr);
    });
    container.appendChild(table);
  }
}
function buildDomTree(prim, node, pathMapping, root = null) {
  const container = document.createElement("div");
  container.classList.add("tree-node");
  if (rootPrim && prim.name === rootPrim.name) {
    container.classList.add("tree-node-root");
  }
  const header = document.createElement("div");
  header.className = "tree-node-header";
  container.appendChild(header);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-node-toggle";
  toggle.setAttribute("aria-label", "Expand or collapse subtree");
  header.appendChild(toggle);
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.title = "Toggle visibility";
  checkbox.addEventListener("click", (evt) => evt.stopPropagation());
  checkbox.addEventListener("change", (evt) => {
    evt.stopPropagation();
    setVisibilityForPrim(prim, checkbox.checked);
  });
  checkboxMap[prim.name] = checkbox;
  header.appendChild(checkbox);
  const label = document.createElement("span");
  label.className = "tree-node-text";
  label.appendChild(document.createTextNode(prim.name ? prim.name.split("/").reverse()[0] : "root"));
  header.appendChild(label);
  const flags = document.createElement("span");
  flags.className = "tree-node-flags material-symbols-outlined";
  flags.textContent = "";
  Object.entries(icons).forEach(([k, v]) => {
    flags.textContent += (prim.attributes || {})[k] ? v : " ";
  });
  header.appendChild(flags);
  domMap[prim.name] = container;
  container.dataset.path = prim.name;
  header.addEventListener("click", (evt) => {
    handleClick(prim, pathMapping, root || prim);
    selectPath(prim.name);
    evt.stopPropagation();
  });
  node.appendChild(container);
  const childWrapper = document.createElement("div");
  childWrapper.className = "tree-node-children";
  container.appendChild(childWrapper);
  const hasChildren = (prim.children || []).length > 0;
  if (!hasChildren) {
    toggle.classList.add("is-leaf");
    toggle.disabled = true;
    toggle.innerHTML = '<span class="material-symbols-outlined">fiber_manual_record</span>';
  } else {
    toggle.classList.add("expanded");
    toggle.innerHTML = '<span class="material-symbols-outlined">expand_more</span>';
    toggle.addEventListener("click", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      if (childWrapper.classList.toggle("collapsed")) {
        toggle.classList.remove("expanded");
        toggle.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
      } else {
        toggle.classList.add("expanded");
        toggle.innerHTML = '<span class="material-symbols-outlined">expand_more</span>';
      }
    });
  }
  (prim.children || []).forEach((p) => buildDomTree(p, childWrapper, pathMapping, root || prim));
}
async function composeAndRender() {
  if (scene) {
    scene.children = scene.children.filter((n) => n instanceof THREE.Light);
  }
  objectMap = {};
  domMap = {};
  primMap = {};
  checkboxMap = {};
  currentPathMapping = null;
  rootPrim = null;
  document.querySelector(".tree").innerHTML = "";
  if (datas.length === 0) {
    return;
  }
  let tree = null;
  let dataArray = datas.map((arr) => arr[1]);
  tree = await compose3(dataArray);
  if (!tree) {
    console.error("No result from composition");
    return;
  }
  if (!scene) {
    await init();
  }
  let pathMapping = {};
  traverseTree([tree], scene, pathMapping);
  currentPathMapping = pathMapping;
  rootPrim = tree;
  if (autoCamera) {
    const boundingBox = new THREE.Box3();
    boundingBox.setFromObject(scene);
    if (!boundingBox.isEmpty()) {
      let avg = boundingBox.min.clone().add(boundingBox.max).multiplyScalar(0.5);
      let ext = boundingBox.max.clone().sub(boundingBox.min).length();
      camera.position.copy(avg.clone().add(new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(ext)));
      camera.far = ext * 3;
      camera.updateProjectionMatrix();
      controls.target.copy(avg);
      controls.update();
      autoCamera = false;
    }
  }
  buildDomTree(tree, document.querySelector(".tree"), pathMapping);
  animate();
}
function createLayerDom() {
  const container = document.querySelector(".layers .layer-list");
  if (!container) {
    return;
  }
  container.innerHTML = "";
  if (datas.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-placeholder";
    empty.textContent = "Load one or more IFC JSON layers to begin exploring the model.";
    container.appendChild(empty);
    return;
  }
  datas.forEach(([name, _], index) => {
    const row = document.createElement("div");
    row.className = "layer-card";
    const label = document.createElement("span");
    label.className = "layer-name";
    label.textContent = name;
    row.appendChild(label);
    const actions = document.createElement("div");
    actions.className = "layer-actions";
    const buttonConfigs = [
      {
        icon: "delete",
        title: "Remove layer",
        handler: () => {
          datas.splice(index, 1);
        }
      },
      {
        icon: "arrow_upward",
        title: "Move layer up",
        handler: () => {
          if (index > 0) {
            [datas[index], datas[index - 1]] = [datas[index - 1], datas[index]];
          }
        }
      },
      {
        icon: "arrow_downward",
        title: "Move layer down",
        handler: () => {
          if (index < datas.length - 1) {
            [datas[index], datas[index + 1]] = [datas[index + 1], datas[index]];
          }
        }
      }
    ];
    buttonConfigs.forEach((config) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "icon-button";
      btn.title = config.title;
      const icon = document.createElement("span");
      icon.className = "material-symbols-outlined";
      icon.textContent = config.icon;
      btn.appendChild(icon);
      btn.onclick = (evt) => {
        evt.stopPropagation();
        config.handler();
        createLayerDom();
        void composeAndRender();
      };
      actions.appendChild(btn);
    });
    row.appendChild(actions);
    container.appendChild(row);
  });
}
async function addModel(name, m) {
  datas.push([name, m]);
  createLayerDom();
  await composeAndRender();
}
async function clearModels() {
  datas = [];
  autoCamera = true;
  createLayerDom();
  await composeAndRender();
}
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
export {
  clearModels,
  composeAndRender,
  addModel as default
};
