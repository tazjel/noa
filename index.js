'use strict';

var aabb = require('aabb-3d')
var vec3 = require('gl-vec3')
var extend = require('extend')
var ndarray = require('ndarray')
var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter
var createContainer = require('./lib/container')
var createRendering = require('./lib/rendering')
var createWorld = require('./lib/world')
var createInputs = require('./lib/inputs')
var createPhysics = require('./lib/physics')
var createCamControls = require('./lib/camera')
var createRegistry = require('./lib/registry')
var createEntities = require('./lib/entities')
var raycast = require('fast-voxel-raycast')


module.exports = Engine




var defaults = {
  playerHeight: 1.8,
  playerWidth: 0.6,
  playerStart: [0, 10, 0],
  playerAutoStep: false,
  tickRate: 30,
  blockTestDistance: 10,
  stickyPointerLock: true,
  dragCameraOutsidePointerLock: true,
  skipDefaultHighlighting: false,
}

/**
 * Main engine object.  
 * Emits: *tick, beforeRender, afterRender, targetBlockChanged*
 * 
 * ```js
 * var noaEngine = require('noa-engine')
 * var noa = noaEngine(opts)
 * ```
 * 
 * @class noa
*/

function Engine(opts) {
  if (!(this instanceof Engine)) return new Engine(opts)
  opts = extend(defaults, opts)
  this._tickRate = opts.tickRate
  this._paused = false
  this._dragOutsideLock = opts.dragCameraOutsidePointerLock
  var self = this

  // container (html/div) manager
  this.container = createContainer(this, opts)

  // inputs manager - abstracts key/mouse input
  this.inputs = createInputs(this, opts, this.container.element)

  // create block/item property registry
  this.registry = createRegistry(this, opts)

  // create world manager
  this.world = createWorld(this, opts)

  // rendering manager - abstracts all draws to 3D context
  this.rendering = createRendering(this, opts, this.container.canvas)

  // Entity manager / Entity Component System (ECS)
  this.entities = createEntities(this, opts)
  // convenience
  this.ents = this.entities

  // physics engine - solves collisions, properties, etc.
  this.physics = createPhysics(this, opts)

  // camera controller
  this.cameraControls = createCamControls(this, opts)


  var ents = this.ents

  /** Entity id for the player entity */
  this.playerEntity = ents.add(
    opts.playerStart,    // starting location- TODO: get from options
    opts.playerWidth, opts.playerHeight,
    null, null,          // no mesh for now, no meshOffset, 
    true, true
  )

  // tag the entity as the player, make it collide with terrain and other entities
  ents.addComponent(this.playerEntity, ents.names.player)
  ents.addComponent(this.playerEntity, ents.names.collideTerrain)
  ents.addComponent(this.playerEntity, ents.names.collideEntities)

  // adjust default physics parameters
  var body = ents.getPhysicsBody(this.playerEntity)
  body.gravityMultiplier = 2 // less floaty
  body.autoStep = opts.playerAutoStep // auto step onto blocks

  /** reference to player entity's physics body */
  this.playerBody = body

  // input component - sets entity's movement state from key inputs
  ents.addComponent(this.playerEntity, ents.names.receivesInputs)

  // add a component to make player mesh fade out when zooming in
  ents.addComponent(this.playerEntity, ents.names.fadeOnZoom)

  // movement component - applies movement forces
  // todo: populate movement settings from options
  var moveOpts = {
    airJumps: 1
  }
  ents.addComponent(this.playerEntity, ents.names.movement, moveOpts)

  // how high above the player's position the eye is (for picking, camera tracking)  
  this.playerEyeOffset = 0.9 * opts.playerHeight





  // Set up block picking functions
  this.blockTestDistance = opts.blockTestDistance || 10

  // plumbing for picking/raycasting
  var world = this.world
  var blockAccessor = function (x, y, z) {
    return world.getBlockID(x, y, z)
  }
  var solidAccessor = function (x, y, z) {
    return world.getBlockSolidity(x, y, z)
  }

  // accessors
  this._traceWorldRay = function (pos, vec, dist, hitPos, hitNorm) {
    return raycast(blockAccessor, pos, vec, dist, hitPos, hitNorm)
  }

  this._traceWorldRayCollision = function (pos, vec, dist, hitPos, hitNorm) {
    return raycast(solidAccessor, pos, vec, dist, hitPos, hitNorm)
  }

  // this gets populated with a data class defined down near updateBlockTargets
  this.targetedBlock = null

  // add a default block highlighting function
  if (!opts.skipDefaultHighlighting) {
    // the default listener, defined onto noa in case people want to remove it later
    this.defaultBlockHighlightFunction = function (tgt) {
      if (tgt) {
        self.rendering.highlightBlockFace(true, tgt.position, tgt.normal)
      } else {
        self.rendering.highlightBlockFace(false)
      }
    }
    this.on('targetBlockChanged', this.defaultBlockHighlightFunction)
  }

  // init rendering stuff that needed to wait for engine internals
  this.rendering.initScene()


  // temp hacks for development

  window.noa = this
  window.ndarray = ndarray
  window.vec3 = vec3
  var debug = false
  this.inputs.bind('debug', 'Z')
  this.inputs.down.on('debug', function onDebug() {
    debug = !debug
    if (debug) window.scene.debugLayer.show(); else window.scene.debugLayer.hide();
  })



}

inherits(Engine, EventEmitter)


/*
 *   Core Engine API
*/




/*
 * Tick function, called by container module at a fixed timestep. Emits #tick(dt),
 * where dt is the tick rate in ms (default 16.6)
*/

Engine.prototype.tick = function () {
  if (this._paused) return

  var dt = this._tickRate       // fixed timesteps!
  this.world.tick(dt)           // chunk creation/removal
  if (this.world._noChunksLoaded) return
  // t0()
  this.physics.tick(dt)         // iterates physics
  // t1('physics tick')
  this.rendering.tick(dt)       // zooms camera, does deferred chunk meshing
  updateBlockTargets(this)      // finds targeted blocks, and highlights one if needed
  this.emit('tick', dt)
  this.inputs.tick()            // clears accumulated tick/mouseMove data
  // debugQueues(this)
}


var __qwasDone = true, __qstart
function debugQueues(self) {
  var a = self.world._chunkIDsToAdd.length
  var b = self.world._chunkIDsPendingCreation.length
  var c = self.rendering._chunksToMesh.length
  var d = self.rendering._numMeshedChunks
  if (a + b + c > 0) console.log([
    'Chunks:', 'unmade', a,
    'pending creation', b,
    'to mesh', c,
    'meshed', d,
  ].join('   \t'))
  if (__qwasDone && a + b + c > 0) {
    __qwasDone = false
    __qstart = performance.now()
  }
  if (!__qwasDone && a + b + c === 0) {
    __qwasDone = true
    console.log('Queue empty after ' + Math.round(performance.now() - __qstart) + 'ms')
  }
}



// hacky temporary profiling substitute 
// since chrome profiling drops fps so much... :(
var t, tot = 0, tc = 0
function t0() {
  t = performance.now()
}
function t1(s) {
  tc++; tot += performance.now() - t
  if (tc < 100) return
  console.log(s, 'avg:', (tot / tc).toFixed(2) + 'ms')
  tc = 0; tot = 0
}



/*
 * Render function, called every animation frame. Emits #beforeRender(dt), #afterRender(dt) 
 * where dt is the time in ms *since the last tick*.
*/

Engine.prototype.render = function (framePart) {
  if (this._paused) return
  var dt = framePart * this._tickRate // ms since last tick
  // only move camera during pointerlock or mousedown, or if pointerlock is unsupported
  if (this.container.hasPointerLock ||
    !this.container.supportsPointerLock ||
    (this._dragOutsideLock && this.inputs.state.fire)) {
    this.cameraControls.updateForRender()
  }
  // clear cumulative mouse inputs
  this.inputs.state.dx = this.inputs.state.dy = 0
  // events and render
  this.emit('beforeRender', dt)
  // t0()
  this.rendering.render(dt)
  // t1('render')
  this.emit('afterRender', dt)
}



/*
 *   Utility APIs
*/

/** 
 * Pausing the engine will also stop render/tick events, etc.
 * @param paused
*/
Engine.prototype.setPaused = function (paused) {
  this._paused = !!paused
  // when unpausing, clear any built-up mouse inputs
  if (!paused) {
    this.inputs.state.dx = this.inputs.state.dy = 0
  }
}

/** @param x,y,z */
Engine.prototype.getBlock = function (x, y, z) {
  if (x.length) {
    return this.world.getBlockID(x[0], x[1], x[2])
  } else {
    return this.world.getBlockID(x, y, z)
  }
}

/** @param x,y,z */
Engine.prototype.setBlock = function (id, x, y, z) {
  // skips the entity collision check
  if (x.length) {
    return this.world.setBlockID(id, x[0], x[1], x[2])
  } else {
    return this.world.setBlockID(id, x, y, z)
  }
}

/**
 * Adds a block unless obstructed by entities 
 * @param id,x,y,z */
Engine.prototype.addBlock = function (id, x, y, z) {
  // add a new terrain block, if nothing blocks the terrain there
  if (x.length) {
    if (this.entities.isTerrainBlocked(x[0], x[1], x[2])) return
    this.world.setBlockID(id, x[0], x[1], x[2])
  } else {
    if (this.entities.isTerrainBlocked(x, y, z)) return
    this.world.setBlockID(id, x, y, z)
  }
}



/** */
Engine.prototype.getPlayerPosition = function () {
  return this.entities.getPosition(this.playerEntity)
}

/** */
Engine.prototype.getPlayerMesh = function () {
  return this.entities.getMeshData(this.playerEntity).mesh
}

/** */
Engine.prototype.setPlayerEyeOffset = function (y) {
  this.playerEyeOffset = y
  var state = this.ents.getState(this.rendering.cameraTarget, this.ents.names.followsEntity)
  state.offset[1] = y
}

/** */
Engine.prototype.getPlayerEyePosition = function () {
  var pos = this.entities.getPosition(this.playerEntity)
  vec3.copy(_eyeLoc, pos)
  _eyeLoc[1] += this.playerEyeOffset
  return _eyeLoc
}
var _eyeLoc = vec3.create()

/** */
Engine.prototype.getCameraVector = function () {
  // rendering works with babylon's xyz vectors
  var v = this.rendering.getCameraVector()
  vec3.set(_camVec, v.x, v.y, v.z)
  return _camVec
}
var _camVec = vec3.create()

/**
 * Raycast through the world, returning a result object for any non-air block
 * @param pos
 * @param vec
 * @param dist
 */
Engine.prototype.pick = function (pos, vec, dist, ignoreNonSolid) {
  if (dist === 0) return null
  pos = pos || this.getPlayerEyePosition()
  vec = vec || this.getCameraVector()
  dist = dist || this.blockTestDistance
  var rpos = _hitResult.position
  var rnorm = _hitResult.normal
  var hit = (ignoreNonSolid) ?
    this._traceWorldRayCollision(pos, vec, dist, rpos, rnorm) :
    this._traceWorldRay(pos, vec, dist, rpos, rnorm)
  if (!hit) return null
  // position is right on a voxel border - adjust it so flooring will work as expected
  for (var i=0; i<3; i++) rpos[i] -= 0.01 * rnorm[i]
  return _hitResult
}
var _hitResult = {
  position: vec3.create(),
  normal: vec3.create(),
}


// Determine which block if any is targeted and within range
// also tell rendering to highlight the struck block face
function updateBlockTargets(noa) {
  var newhash = ''
  var result = noa.pick(null, null, null, true)
  if (result) {
    var dat = _targetedBlockDat
    for (var i = 0; i < 3; i++) {
      // position values are right on a border, so adjust them before flooring!
      var n = result.normal[i] | 0
      var p = Math.floor(result.position[i])
      dat.position[i] = p
      dat.normal[i] = n
      dat.adjacent[i] = p + n
      newhash += '|' + p + '|' + n
    }
    dat.blockID = noa.world.getBlockID(dat.position[0], dat.position[1], dat.position[2])
    newhash += '|' + result.blockID
    noa.targetedBlock = dat
  } else {
    noa.targetedBlock = null
  }
  if (newhash != _prevTargetHash) {
    noa.emit('targetBlockChanged', noa.targetedBlock)
    _prevTargetHash = newhash
  }
}

var _targetedBlockDat = {
  blockID: 0,
  position: [],
  normal: [],
  adjacent: [],
}

var _prevTargetHash = ''




