// (C) buildingSMART International
// published under MIT license 

import { ComposedObject } from './composed-object';
import { IfcxFile } from '../ifcx-core/schema/schema-helper';
import { compose3 } from './compose-flattened';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';

let controls, renderer, scene, camera;
type datastype = [string, IfcxFile][];
let datas: datastype = [];
let autoCamera = true;


let objectMap: { [path: string]: any } = {};
let domMap: { [path: string]: HTMLElement } = {};
let primMap: { [path: string]: ComposedObject } = {};
let checkboxMap: { [path: string]: HTMLInputElement } = {};
let currentPathMapping: any = null;
let rootPrim: ComposedObject | null = null;

let selectedObject: any = null;
let selectedDom: HTMLElement | null = null;


let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();

var envMap;

async function init() {
    scene = new THREE.Scene();
    
    // lights
    const ambient = new THREE.AmbientLight(0xddeeff, 0.4);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(5, -10, 7.5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
    fillLight.position.set(-5, 5, 5);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(0, 8, -10);
    scene.add(rimLight);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);

    camera.up.set(0, 0, 1);
    camera.position.set(50, 50, 50);
    camera.lookAt(0, 0, 0);

    const nd = document.querySelector('.viewport');
    renderer = new THREE.WebGLRenderer({
        alpha: true,
        logarithmicDepthBuffer: true
    });

    // for GLTF PBR rendering, create environment map using PMREMGenerator:
    // see https://threejs.org/docs/#api/en/extras/PMREMGenerator
    
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    new RGBELoader()
        .load("images/wildflower_field_1k.hdr", function (texture) {
            envMap = pmremGenerator.fromEquirectangular(texture).texture;
            
            // uncomment to also show the skybox on screen, instead of only in PBR reflections:
            //scene.background = envMap;
            //scene.backgroundRotation.x = 0.5 * Math.PI
            scene.environment = envMap;
    
            texture.dispose();
            pmremGenerator.dispose();
        });

    //@ts-ignore
    renderer.setSize(nd.offsetWidth, nd.offsetHeight);

    //@ts-ignore
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;

    nd!.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('click', onCanvasClick);

    return scene;
}

function HasAttr(node: ComposedObject | undefined, attrName: string)
{
    if (!node || !node.attributes) return false;
    return !!node.attributes[attrName];
}

function FindChildWithAttr(node: ComposedObject | undefined, attrName: string)
{
    if (!node || !node.children) return undefined;
    for (let i = 0; i < node.children.length; i++)
    {
        if (HasAttr(node.children[i], attrName))
        {
            return node.children[i];
        }
    }

    return undefined;
}

function setHighlight(obj: any, highlight: boolean) {
    if (!obj) return;
    obj.traverse((o) => {
        const mat = o.material;
        if (mat && mat.color) {
            if (highlight) {
                if (!o.userData._origColor) {
                    o.userData._origColor = mat.color.clone();
                }
                o.material = mat.clone();
                o.material.color.set(0xff0000);
            } else if (o.userData._origColor) {
                mat.color.copy(o.userData._origColor);
                delete o.userData._origColor;
            }
        }
    });
}

function expandAncestors(node: HTMLElement | null) {
    let current = node;
    while (current) {
        if (current.classList.contains('tree-node')) {
            const toggle = current.querySelector(':scope > .tree-node-header .tree-node-toggle') as HTMLButtonElement | null;
            const children = current.querySelector(':scope > .tree-node-children') as HTMLElement | null;
            if (children && children.classList.contains('collapsed')) {
                children.classList.remove('collapsed');
                if (toggle && !toggle.classList.contains('is-leaf')) {
                    toggle.classList.add('expanded');
                    toggle.innerHTML = '<span class="material-symbols-outlined">expand_more</span>';
                }
            }
        }

        const parentChildren = current.parentElement;
        if (!parentChildren) {
            break;
        }
        if (parentChildren.classList.contains('tree-node-children')) {
            current = parentChildren.parentElement as HTMLElement | null;
        } else {
            current = parentChildren;
        }
    }
}

function selectPath(path: string | null) {
    if (!path) {
        if (selectedObject) setHighlight(selectedObject, false);
        if (selectedDom)    selectedDom.classList.remove('selected');
        selectedObject = null;
        selectedDom    = null;
        return;
    }

    if (selectedObject) {
        setHighlight(selectedObject, false);
    }
    if (selectedDom) {
        selectedDom.classList.remove('selected');
    }
    selectedObject = objectMap[path] || null;
    selectedDom = domMap[path] || null;
    if (selectedObject) setHighlight(selectedObject, true);
    if (selectedDom) selectedDom.classList.add('selected');
    expandAncestors(selectedDom);
}

function onCanvasClick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
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
    }
    else {
        selectPath(null);
    }
}

function tryCreateMeshGltfMaterial(path: ComposedObject[]) {

    // check for PBR defined by the gltf::material schema
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
            // if none of the gltf::material properties are defined, we don't use pbr rendering, but default to the bsi::ifc::presentation definitions
            continue;
        }

        // otherwise, we know that we want a PBR material. If a property is null, we use the default defined by the gltf specification:
        // see https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-material

        let material = new THREE.MeshStandardMaterial();

        // define defaults:
        material.color = new THREE.Color(1.0, 1.0, 1.0);
        material.metalness = 1.0;
        material.roughness = 1.0;
        
        // note that not all GLTF properties are converted here yet to the THREE.MeshStandardMaterial PBR material, 
        // such as reading the texture URLs or from base64, this should be added. 

        if (pbrMetallicRoughness) {
            let baseColorFactor = pbrMetallicRoughness["baseColorFactor"];
            if (baseColorFactor) {
                material.color = new THREE.Color(baseColorFactor[0], baseColorFactor[1], baseColorFactor[2]);
            }

            let metallicFactor = pbrMetallicRoughness["metallicFactor"];
            if (metallicFactor !== undefined) {
                material.metalness = metallicFactor;
            }

            let roughnessFactor = pbrMetallicRoughness["roughnessFactor"];
            if (roughnessFactor !== undefined) {
                material.roughness = roughnessFactor;
            }
        }
        material.envMap = envMap
        material.needsUpdate = true
        material.envMapRotation = new THREE.Euler(0.5 * Math.PI, 0, 0);
        // console.log(material)
        return material;
    }

    return undefined
}

function createMaterialFromParent(path: ComposedObject[]) {
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

function createCurveFromJson(path: ComposedObject[]) {
  let points = new Float32Array(path[0].attributes["usd::usdgeom::basiscurves::points"].flat());
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  
  const material = createMaterialFromParent(path);
  let lineMaterial = new THREE.LineBasicMaterial({ ...material });
  lineMaterial.color.multiplyScalar(0.8);
  
  return new THREE.Line(geometry, lineMaterial);
}

function createMeshFromJson(path: ComposedObject[]) {
  let points = new Float32Array(path[0].attributes["usd::usdgeom::mesh::points"].flat());
  let indices = new Uint16Array(path[0].attributes["usd::usdgeom::mesh::faceVertexIndices"]);
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  
  
  var meshMaterial;
  
  let gltfPbrMaterial = tryCreateMeshGltfMaterial(path);
  if (gltfPbrMaterial) {
    meshMaterial = gltfPbrMaterial
    // console.log(meshMaterial)
  } else {
    const m = createMaterialFromParent(path);
    meshMaterial = new THREE.MeshLambertMaterial({ ...m });
  }

  return new THREE.Mesh(geometry, meshMaterial);
}

// functions for creating point clouds
function createPointsFromJsonPcdBase64(path: ComposedObject[]) {
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

function createPoints(geometry: THREE.BufferGeometry, withColors: boolean): THREE.Points {
    const material = new THREE.PointsMaterial();
    material.sizeAttenuation = false;
    material.fog = true;
    material.size = 5;
    material.color = new THREE.Color(withColors ? 0xffffff : 0x000000);

    if (withColors) {
        material.vertexColors = true;
    }
    return new THREE.Points(geometry, material);
}

function createPointsFromJsonArray(path: ComposedObject[]) {
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

function base64ToArrayBuffer(str): ArrayBuffer | undefined {
    let binary;
    try {
        binary = atob(str);
    }
    catch(e) {
        throw new Error("base64 encoded string is invalid");
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; ++i) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function createPointsFromJsonPositionBase64(path: ComposedObject[]) {
    const geometry = new THREE.BufferGeometry();

    const positions_base64 = path[0].attributes["points::base64::positions"];
    const positions_bytes = base64ToArrayBuffer(positions_base64);
    if (!positions_bytes) {
        return null;
    }
    const positions = new Float32Array(positions_bytes!);
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    
    const colors_base64 = path[0].attributes["points::base64::colors"];
    if (colors_base64) {
        const colors_bytes = base64ToArrayBuffer(colors_base64);
        if (colors_bytes) {
            const colors = new Float32Array(colors_bytes!);
            geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        }
    }
    return createPoints(geometry, colors_base64);
}

function traverseTree(path: ComposedObject[], parent, pathMapping) {
    const node = path[0];
    let elem: any = new THREE.Group();
    if (HasAttr(node, "usd::usdgeom::visibility::visibility"))
    {
        if (node.attributes["usd::usdgeom::visibility::visibility"] === 'invisible') {
            return;
        }
    }
    else if (HasAttr(node, "usd::usdgeom::mesh::points")) 
    {
        elem = createMeshFromJson(path);
    } 
    else if (HasAttr(node, "usd::usdgeom::basiscurves::points"))
    {
        elem = createCurveFromJson(path);
    }
    // point cloud data types:
    else if (HasAttr(node, "pcd::base64"))
    {
        elem = createPointsFromJsonPcdBase64(path);
    }
    else if (HasAttr(node, "points::array::positions"))
    {
        elem = createPointsFromJsonArray(path);
    }
    else if (HasAttr(node, "points::base64::positions"))
    {
        elem = createPointsFromJsonPositionBase64(path);
    }
    
    objectMap[node.name] = elem;
    primMap[node.name] = node;
    elem.userData.path = node.name;

    for (let path of Object.entries(node.attributes || {}).filter(([k, _]) => k.startsWith('__internal_')).map(([_, v]) => v)) {
      (pathMapping[String(path)] = pathMapping[String(path)] || []).push(node.name);
    }

    parent.add(elem);
    if (path.length > 1) {
        elem.matrixAutoUpdate = false;

        let matrixNode = node.attributes && node.attributes['usd::xformop::transform'] ? node.attributes['usd::xformop::transform'].flat() : null;
        if (matrixNode) {
            let matrix = new THREE.Matrix4();
            //@ts-ignore
            matrix.set(...matrixNode);
            matrix.transpose();
            elem.matrix = matrix;
        }
    }

    (node.children || []).forEach(child => traverseTree([child, ...path], elem || parent, pathMapping));
}

function encodeHtmlEntities(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
};

const icons = {
    'usd::usdgeom::mesh::points': 'deployed_code', 
    'usd::usdgeom::basiscurves::points': 'line_curve',
    'usd::usdshade::material::outputs::surface.connect': 'line_style',
    'pcd::base64': 'grain',
    'points::array::positions': 'grain',
    'points::base64::positions': 'grain',
};

function setVisibilityForPrim(prim: ComposedObject | null, visible: boolean) {
    if (!prim) {
        return;
    }

    const stack: ComposedObject[] = [prim];
    while (stack.length > 0) {
        const current = stack.pop()!;
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
  const entries = [["name", prim.name], ...Object.entries(prim.attributes).filter(([k, _]) => !k.startsWith('__internal_'))];
  const format = (value) => {
    if (Array.isArray(value)) {
      let N = document.createElement('span');
      N.appendChild(document.createTextNode('('));
      let first = true;
      for (let n of value.map(format)) {
        if (!first) {
          N.appendChild(document.createTextNode(','));
        }
        N.appendChild(n);
        first = false;
      }
      N.appendChild(document.createTextNode(')'));
      return N;
    } else if (typeof value === "object") {
      const ks = Object.keys(value);
      if (ks.length == 1 && ks[0] === 'ref' && pathMapping[value.ref] && pathMapping[value.ref].length == 1) {
        let a = document.createElement('a');
        let resolvedRefAsPath = pathMapping[value.ref][0];
        a.setAttribute('href', '#');
        a.textContent = resolvedRefAsPath;
        a.onclick = () => {
          let prim = null;
          const recurse = (n) => {
            if (n.name === resolvedRefAsPath) {
              prim = n;
            } else {
              (n.children || []).forEach(recurse);
            }
          }
          recurse(root);
          if (prim) { 
            handleClick(prim, pathMapping, root);
          }
        }
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

function buildDomTree(prim, node, pathMapping, root=null) {
    const container = document.createElement('div');
    container.classList.add('tree-node');
    if (rootPrim && prim.name === rootPrim.name) {
        container.classList.add('tree-node-root');
    }

    const header = document.createElement('div');
    header.className = 'tree-node-header';
    container.appendChild(header);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tree-node-toggle';
    toggle.setAttribute('aria-label', 'Expand or collapse subtree');
    header.appendChild(toggle);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.title = 'Toggle visibility';
    checkbox.addEventListener('click', (evt) => evt.stopPropagation());
    checkbox.addEventListener('change', (evt) => {
        evt.stopPropagation();
        setVisibilityForPrim(prim, checkbox.checked);
    });
    checkboxMap[prim.name] = checkbox;
    header.appendChild(checkbox);

    const label = document.createElement('span');
    label.className = 'tree-node-text';
    label.appendChild(document.createTextNode(prim.name ? prim.name.split('/').reverse()[0] : 'root'));
    header.appendChild(label);

    const flags = document.createElement('span');
    flags.className = 'tree-node-flags material-symbols-outlined';
    flags.textContent = '';
    Object.entries(icons).forEach(([k, v]) => {
        flags.textContent += (prim.attributes || {})[k] ? v : ' ';
    });
    header.appendChild(flags);

    domMap[prim.name] = container as HTMLElement;
    container.dataset.path = prim.name;

    header.addEventListener('click', (evt) => {
        handleClick(prim, pathMapping, root || prim);
        selectPath(prim.name);
        evt.stopPropagation();
    });

    node.appendChild(container);
    const childWrapper = document.createElement('div');
    childWrapper.className = 'tree-node-children';
    container.appendChild(childWrapper);

    const hasChildren = (prim.children || []).length > 0;
    if (!hasChildren) {
        toggle.classList.add('is-leaf');
        toggle.disabled = true;
        toggle.innerHTML = '<span class="material-symbols-outlined">fiber_manual_record</span>';
    } else {
        toggle.classList.add('expanded');
        toggle.innerHTML = '<span class="material-symbols-outlined">expand_more</span>';
        toggle.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            if (childWrapper.classList.toggle('collapsed')) {
                toggle.classList.remove('expanded');
                toggle.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
            } else {
                toggle.classList.add('expanded');
                toggle.innerHTML = '<span class="material-symbols-outlined">expand_more</span>';
            }
        });
    }

    (prim.children || []).forEach(p => buildDomTree(p, childWrapper, pathMapping, root || prim));
}

export async function composeAndRender() {
    if (scene) {
        // @todo does this actually free up resources?
        // retain only the lights
        scene.children = scene.children.filter(n => n instanceof THREE.Light);
    }

    objectMap = {};
    domMap = {};
    primMap = {};
    checkboxMap = {};
    currentPathMapping = null;
    rootPrim = null;

    document.querySelector('.tree')!.innerHTML = '';

    if (datas.length === 0) {
        return;
    }

    let tree: null | ComposedObject = null;
    let dataArray = datas.map(arr => arr[1]);
    
    tree = await compose3(dataArray as IfcxFile[]);
    if (!tree) {
        console.error("No result from composition");
        return;
    }

    if (!scene) {
        await init()
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
            camera.position.copy(avg.clone().add(new THREE.Vector3(1,1,1).normalize().multiplyScalar(ext)));
            camera.far = ext * 3;
            camera.updateProjectionMatrix();
            controls.target.copy(avg);
            controls.update();
            
            // only on first successful load
            autoCamera = false;
        }
    }

    buildDomTree(tree, document.querySelector('.tree'), pathMapping);
    animate();
}

function createLayerDom() {
    const container = document.querySelector('.layers .layer-list') as HTMLElement | null;
    if (!container) {
        return;
    }

    container.innerHTML = '';

    if (datas.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-placeholder';
        empty.textContent = 'Load one or more IFC JSON layers to begin exploring the model.';
        container.appendChild(empty);
        return;
    }

    datas.forEach(([name, _], index) => {
        const row = document.createElement('div');
        row.className = 'layer-card';

        const label = document.createElement('span');
        label.className = 'layer-name';
        label.textContent = name;
        row.appendChild(label);

        const actions = document.createElement('div');
        actions.className = 'layer-actions';

        const buttonConfigs: Array<{ icon: string, title: string, handler: () => void }> = [
            {
                icon: 'delete',
                title: 'Remove layer',
                handler: () => {
                    datas.splice(index, 1);
                }
            },
            {
                icon: 'arrow_upward',
                title: 'Move layer up',
                handler: () => {
                    if (index > 0) {
                        [datas[index], datas[index - 1]] = [datas[index - 1], datas[index]];
                    }
                }
            },
            {
                icon: 'arrow_downward',
                title: 'Move layer down',
                handler: () => {
                    if (index < datas.length - 1) {
                        [datas[index], datas[index + 1]] = [datas[index + 1], datas[index]];
                    }
                }
            }
        ];

        buttonConfigs.forEach((config) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'icon-button';
            btn.title = config.title;

            const icon = document.createElement('span');
            icon.className = 'material-symbols-outlined';
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

export default async function addModel(name, m: IfcxFile) {
    datas.push([name, m]);
    createLayerDom();
    await composeAndRender();
}

export async function clearModels() {
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
