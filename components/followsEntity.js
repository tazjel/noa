'use strict'

var vec3 = require('gl-vec3')
var _tempVec = vec3.create()


/*
 * Indicates that an entity should be moved to another entity's position each tick,
 * possibly by a fixed offset, and the same for renderPositions each render
*/

module.exports = function (noa) {

	return {

		name: 'followsEntity',

		state: {
			entity: 0 | 0,
			offset: null,
		},

		onAdd: function (eid, state) {
			var off = vec3.create()
			state.offset = (state.offset) ? vec3.copy(off, state.offset) : off
			updatePosition(state)
			updateRenderPosition(state)
		},

		onRemove: null,


		// on tick, copy over regular positions
		system: function followEntity(dt, states) {
			for (var i = 0; i < states.length; i++) {
				updatePosition(states[i])
			}
		},


		// on render, copy over render positions
		renderSystem: function followEntityMesh(dt, states) {
			for (var i = 0; i < states.length; i++) {
				updateRenderPosition(states[i])
			}
		}
	}



	function updatePosition(state) {
		var pos = _tempVec
		var id = state.__id
		var self = noa.ents.getPositionData(id)
		var other = noa.ents.getPositionData(state.entity)
		if (other) {
			vec3.add(pos, other.position, state.offset)
			self.setPosition(pos[0], pos[1], pos[2])
		} else {
			noa.ents.removeComponentLater(id, noa.noa.ents.names.followsEntity)
		}
	}

	function updateRenderPosition(state) {
		var pos = _tempVec
		var id = state.__id
		var self = noa.ents.getPositionData(id)
		var other = noa.ents.getPositionData(state.entity)
		if (other) {
			vec3.add(self.renderPosition, other.renderPosition, state.offset)
		} else {
			noa.ents.removeComponentLater(id, noa.ents.names.followsEntity)
		}
	}

}


