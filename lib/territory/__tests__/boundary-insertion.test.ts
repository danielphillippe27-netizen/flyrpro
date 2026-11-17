import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryInsertionIndex } from '../boundary-insertion';
const square = [[0,0],[10,0],[10,10],[0,10]];
test('new pins go into all four edges, including the closing edge', () => {
  assert.equal(boundaryInsertionIndex([5,-1],square),1);
  assert.equal(boundaryInsertionIndex([11,5],square),2);
  assert.equal(boundaryInsertionIndex([5,11],square),3);
  assert.equal(boundaryInsertionIndex([-1,5],square),4);
});
test('first three pins append; repeated insertions preserve the boundary order', () => {
  for(let n=0;n<3;n++) assert.equal(boundaryInsertionIndex([5,-1],square.slice(0,n)),n);
  const points = square.map(p => [...p]);
  points.splice(boundaryInsertionIndex([5,-1],points),0,[5,-1]);
  assert.equal(boundaryInsertionIndex([2,-1],points),1);
  assert.equal(boundaryInsertionIndex([8,-1],points),2);
  assert.equal(boundaryInsertionIndex([0,2],[[0,0],[0,0],[5,0],[5,5],[0,5]]),5);
});
