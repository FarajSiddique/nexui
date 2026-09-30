import assert from 'node:assert/strict';
import test from 'node:test';

import { fitRegion, MIN_MAP_DELTA } from '../apps/mobile/src/lib/map-region.ts';

const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} ≠ ${expected}`);

test('no places, no region', () => {
  assert.equal(fitRegion([]), null);
});

test('two places are centered with padding', () => {
  const region = fitRegion([
    { lat: 35.68, lng: 139.69 },
    { lat: 35.01, lng: 135.77 },
  ]);

  close(region.latitude, 35.345, 'latitude');
  close(region.longitude, 137.73, 'longitude');
  close(region.latitudeDelta, 0.67 * 1.5, 'latitudeDelta');
  close(region.longitudeDelta, 3.92 * 1.5, 'longitudeDelta');
});

test('one place gets a city-sized frame instead of an infinite zoom', () => {
  assert.deepEqual(fitRegion([{ lat: 41.88, lng: -87.63 }]), {
    latitude: 41.88,
    longitude: -87.63,
    latitudeDelta: MIN_MAP_DELTA,
    longitudeDelta: MIN_MAP_DELTA,
  });
});

test('a trip across the date line frames the short way round', () => {
  const region = fitRegion([
    { lat: -17.7, lng: 178.0 },
    { lat: -13.8, lng: -172.1 },
  ]);

  close(region.longitude, -177.05, 'longitude');
  close(region.longitudeDelta, 9.9 * 1.5, 'longitudeDelta');
});

test('a round-the-world trip never asks for more than the whole map', () => {
  const region = fitRegion([
    { lat: 80, lng: -170 },
    { lat: -80, lng: 0 },
    { lat: 0, lng: 170 },
  ]);

  assert.ok(region.latitudeDelta <= 170);
  assert.ok(region.longitudeDelta <= 360);
});
