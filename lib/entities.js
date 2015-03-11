'use strict';

var extend = require('extend')
var aabb = require('aabb-3d')
var vec3 = require('gl-vec3')
var boxIntersect = require('box-intersect')
var inherits = require('inherits')
var EventEmitter = require('events').EventEmitter

module.exports = function(noa, opts) {
  return new EntityManager(noa, opts)
}

var defaults = {

}


/* 
 *  Wrangles entities.
 *    An entity is anything with a physics body, bounding box, or mesh
 *    Entities emit events: tick, collideTerrain, collideEntity
*/

function EntityManager(noa, opts) {
  this.noa = noa
  var _opts = extend(defaults, opts)

  this.entities = []
  this._toRemove = []
}


/*
 *    ENTITY MANAGER API
*/

EntityManager.prototype.tick = function(dt) {
  // handle any deferred entities that need removing
  doDeferredRemovals(this)
  // entity-entity collisions
  doEntityCollisions(this)
  // iterate, call tick fcns, update mesh positions
  for (var i=0; i<this.entities.length; ++i) {
    var ent = this.entities[i]
    if (ent.mesh) {
      ent.mesh.position.x = ent.bb.base[0] + ent.meshOffset[0]
      ent.mesh.position.y = ent.bb.base[1] + ent.meshOffset[1]
      ent.mesh.position.z = ent.bb.base[2] + ent.meshOffset[2]
    }
    ent.emit('tick',dt)
  }
}


EntityManager.prototype.isTerrainBlocked = function(x,y,z) {
  // checks if terrain location is blocked by entities
  var newbb = new aabb( [x,y,z], [1,1,1] )
  for (var i=0; i<this.entities.length; ++i) {
    if (this.entities[i]._collideTerrain) {
      var bb = this.entities[i].bb
      if (bb.intersects(newbb) && ! bb.touches(newbb)) return true;
    }
  }
  return false
}


// Add a new entity to be managed.
// shape modeled only as an AABB, 'position' at center of bottom face.
// meshCreateFcn is of signature 'function(scene)'
EntityManager.prototype.add = function( position, width, height, // required
                                         mesh, meshOffset, 
                                         data, doPhysics,
                                         collideTerrain, collideEntities ) {
  // bounding box
  var bb = new aabb([position[0]-width/2, position[1], position[2]-width/2],
                    [width, height, width])
  // rigid body in physics simulator
  var body = (doPhysics) ? this.noa.physics.addBody(bb) : null
  // entity class (data struct more or less)
  var ent = new Entity(bb, body, mesh, meshOffset, data, 
                       collideTerrain, collideEntities )
  this.entities.push(ent)
  return ent
}


EntityManager.prototype.remove = function(ent) {
  // defer removal until next tick function, since entities are likely to
  // call this on themselves during collsion handlers or tick functions
  if (this._toRemove.indexOf(ent) == -1) this._toRemove.push(ent);
}


/*
 *  INTERNALS
*/

function doDeferredRemovals(self) {
  while (self._toRemove.length) {
    var ent = self._toRemove.pop()
    var i = self.entities.indexOf(ent)
    if (i>-1) self.entities.splice(i,1)
    if (ent.mesh) ent.mesh.dispose()
    if (ent.body) self.noa.physics.removeBody(ent.body)
    // in case it helps the GC
    ent.removeAllListeners()
    ent.body = ent.mesh = ent.bb = ent.data = null
  }
}


function doEntityCollisions(self) {
  // build array of [lo, lo, hi, hi] arrays
  var intervals = [], indexes = []
  for (var i=0; i<self.entities.length; ++i) {
    var e = self.entities[i]
    if (e._collideEntities) {
      var lo = e.bb.base
      var s = e.bb.vec
      intervals.push([ lo[0], lo[1], lo[2], lo[0]+s[0], lo[1]+s[1], lo[2]+s[2] ])
      indexes.push(i)
    }
  }
  // collision test them and send events
  boxIntersect( intervals, entEntCollision.bind(null, self.entities, indexes) )
}
function entEntCollision(entities, indexes, i, j) {
  var ei = entities[indexes[i]]
  var ej = entities[indexes[j]]
  ei.emit('collideEntity', ej)
  ej.emit('collideEntity', ei)
}



/*
 *  ENTITY struct:
 *
 *  bb:       bounding box (effectively overridden by physics body if there is one)
 *  body:     optional reference to rigid body managed by physics engine
 *  mesh:     optional reference to mesh managed by renderer
 *  meshOffset: offset from base of aabb to mesh's registration point
 *  data:     arbtitrary object
 *  collTerr: whether to prevent new terrain overlapping the entity
 *  collEnt:  whether to collision test with other entities
*/

function Entity(bb, body, mesh, meshOffset, data, 
                 collTerr, collEnt) {
  this.body = body || null
  this.mesh = mesh || null
  this.meshOffset = meshOffset || [0,0,0]
  this.data = data || null
  this.bb = (body) ? body.aabb : bb
  this._collideEntities = collEnt
  this._collideTerrain = collTerr
  // if physics terrain collisions needed, wrap physics engine's onCollide
  if (body && collTerr) {
    this.body.onCollide = onTerrainCollide.bind(null,this)
  }
}
inherits(Entity, EventEmitter)
function onTerrainCollide(entity, impulse) {
  entity.emit('collideTerrain', impulse)
}


// Entity APIs:

// get "feet" position - center of bottom face
Entity.prototype.getPosition = function() {
  var loc = this.bb.base
  var size = this.bb.vec
  return [ loc[0]+size[0]/2, loc[1], loc[2]+size[2]/2 ]
}




