import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = readFileSync(new URL('../src/ScreenShareStage.tsx', import.meta.url), 'utf8');
const exports = {};
const iconMock = (props) => React.createElement('span', props);
const lucideMock = new Proxy({}, { get: () => iconMock });

new Function(
  'exports',
  'require',
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
)(exports, (name) => {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return jsx;
  if (name === '@livekit/components-react') {
    return {
      VideoTrack: (props) => React.createElement('video', {
        className: props.className,
        'aria-label': props['aria-label'],
        onResize: props.onResize,
      }),
    };
  }
  if (name === 'livekit-client') {
    return {
      VideoQuality: { LOW: 0, MEDIUM: 1, HIGH: 2 },
    };
  }
  if (name === 'react-zoom-pan-pinch') {
    return {
      TransformWrapper: ({ children }) => React.createElement('div', null, typeof children === 'function' ? children({}) : children),
      TransformComponent: ({ children }) => React.createElement('div', null, children),
    };
  }
  if (name === './useTrackUnavailable') {
    return {
      useTrackUnavailable: () => false,
    };
  }
  return lucideMock;
});

const { ScreenShareStage, getAdaptiveViewerOptions, parseTrackNameResolution, getResolutionFromHeight } = exports;

function mockScreenTrack(isLocal = false, attributes = {}, trackName = undefined) {
  let videoQuality = null;
  let videoDimensions = null;
  const listeners = {};
  return {
    participant: {
      identity: isLocal ? 'local-user' : 'remote-user',
      name: isLocal ? 'Presenter Lokal' : 'Presenter Jauh',
      isLocal,
      attributes,
      on(event, fn) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      off(event, fn) {
        if (!listeners[event]) return;
        listeners[event] = listeners[event].filter(l => l !== fn);
      },
      emit(event, ...args) {
        (listeners[event] || []).forEach(fn => fn(...args));
      },
    },
    publication: {
      trackSid: 'TR_SCREEN_1',
      trackName,
      track: { mediaStreamTrack: { readyState: 'live' } },
      setVideoQuality(q) { videoQuality = q; },
      setVideoDimensions(d) { videoDimensions = d; },
      get videoQuality() { return videoQuality; },
      get videoDimensions() { return videoDimensions; },
    },
  };
}

test('ScreenShareStage provides quality options for remote viewers and shows circular loading progress then finish sign', async t => {
  const remoteTrack = mockScreenTrack(false);
  let root;

  await act(async () => {
    root = create(
      React.createElement(ScreenShareStage, {
        tracks: [remoteTrack],
        focused: false,
        showThumbnails: false,
        fullscreen: false,
        fullscreenPending: false,
        fullscreenSupported: true,
        onFocus: () => {},
        onThumbnails: () => {},
        onFullscreen: () => {},
      })
    );
  });
  t.after(async () => { await act(async () => root.unmount()); });

  // Find the quality select for the viewer
  const selects = root.root.findAllByType('select');
  const qualitySelect = selects.find(s => s.props['aria-label'] === 'Pilih kualitas penerimaan video');
  assert.ok(qualitySelect, 'Viewer quality select should be present');

  // Verify option values
  const optionValues = qualitySelect.findAllByType('option').map(o => o.props.value);
  assert.ok(optionValues.includes('original'));
  assert.ok(optionValues.includes('4k'));
  assert.ok(optionValues.includes('1440p'));
  assert.ok(optionValues.includes('1080p'));
  assert.ok(optionValues.includes('720p'));
  assert.ok(optionValues.includes('540p'));
  assert.ok(optionValues.includes('360p'));
  assert.ok(optionValues.includes('auto'));

  // Viewer changes quality to 720p
  await act(async () => {
    qualitySelect.props.onChange({ target: { value: '720p' } });
  });

  // Verify circular loading progress appears
  const pillLoading = root.root.findAll(el => el.props.className && el.props.className.includes('screen-share-resolution-pill'));
  assert.equal(pillLoading.length, 1, 'Resolution overlay pill should be visible');
  assert.ok(pillLoading[0].props.className.includes('is-loading'));

  const loadingText = root.root.findAll(el => el.props.className && el.props.className.includes('resolution-pill-text'));
  assert.ok(loadingText[0].children.join('').includes('Menerapkan resolusi 720p'));

  // SVG circular progress spinner should be rendered
  const spinners = root.root.findAll(el => el.props.className && el.props.className.includes('circular-progress-svg'));
  assert.ok(spinners.length >= 1, 'Circular progress SVG should be rendered');

  // Fast-forward transition timer to complete resolution application
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 800));
  });

  // Verify finish sign is displayed
  const pillFinished = root.root.findAll(el => el.props.className && el.props.className.includes('screen-share-resolution-pill'));
  assert.equal(pillFinished.length, 1);
  assert.ok(pillFinished[0].props.className.includes('is-finished'), 'Pill should transition to is-finished state');

  const finishText = root.root.findAll(el => el.props.className && el.props.className.includes('resolution-pill-text'));
  assert.ok(finishText[0].children.join('').includes('Resolusi 720p diterapkan'), 'Should sign completion to viewer');

  // Checkmark finish icon should be present
  const finishIcon = root.root.findAll(el => el.props.className && el.props.className.includes('circular-finish-icon'));
  assert.equal(finishIcon.length, 1, 'Circular checkmark finish icon should be visible');
});

test('ScreenShareStage provides presenter resolution options when user is sharing', async t => {
  const localTrack = mockScreenTrack(true);
  let chosenRes = null;
  let root;

  await act(async () => {
    root = create(
      React.createElement(ScreenShareStage, {
        tracks: [localTrack],
        focused: false,
        showThumbnails: false,
        fullscreen: false,
        fullscreenPending: false,
        fullscreenSupported: true,
        screenShareResolution: '1080p',
        onSelectScreenShareResolution: (res) => { chosenRes = res; },
        onFocus: () => {},
        onThumbnails: () => {},
        onFullscreen: () => {},
      })
    );
  });
  t.after(async () => { await act(async () => root.unmount()); });

  const presenterSelect = root.root.find(el => el.type === 'select' && el.props['aria-label'] === 'Pilih resolusi berbagi layar');
  assert.ok(presenterSelect, 'Presenter resolution select should be present for local participant');

  await act(async () => {
    presenterSelect.props.onChange({ target: { value: '720p' } });
  });

  assert.equal(chosenRes, '720p', 'Presenter resolution selection should trigger callback');

  // Verify feedback is also shown for presenter
  const pill = root.root.findAll(el => el.props.className && el.props.className.includes('screen-share-resolution-pill'));
  assert.equal(pill.length, 1);
});

test('getAdaptiveViewerOptions restricts options according to presenter ceiling', () => {
  const options720 = getAdaptiveViewerOptions('720p');
  assert.deepEqual(options720.map(o => o.value), ['720p', '540p', '360p', 'auto']);
  assert.equal(options720[0].label, '720p (Maksimal Presenter • HD)');

  const options1080 = getAdaptiveViewerOptions('1080p');
  assert.deepEqual(options1080.map(o => o.value), ['1080p', '720p', '540p', '360p', 'auto']);
  assert.equal(options1080[0].label, '1080p (Maksimal Presenter • Full HD)');

  const options360 = getAdaptiveViewerOptions('360p');
  assert.deepEqual(options360.map(o => o.value), ['360p', 'auto']);
  assert.equal(options360[0].label, '360p (Maksimal Presenter • Hemat Kuota)');

  const optionsOriginal = getAdaptiveViewerOptions('original');
  assert.deepEqual(optionsOriginal.map(o => o.value), ['original', '4k', '1440p', '1080p', '720p', '540p', '360p', 'auto']);
});

test('parseTrackNameResolution parses screen_share track names correctly', () => {
  assert.equal(parseTrackNameResolution('screen_share:720p'), '720p');
  assert.equal(parseTrackNameResolution('screen_share:4k'), '4k');
  assert.equal(parseTrackNameResolution('screen_share:invalid'), undefined);
  assert.equal(parseTrackNameResolution(undefined), undefined);
});

test('getResolutionFromHeight maps video pixel heights to resolution tiers', () => {
  assert.equal(getResolutionFromHeight(2160), '4k');
  assert.equal(getResolutionFromHeight(1440), '1440p');
  assert.equal(getResolutionFromHeight(1080), '1080p');
  assert.equal(getResolutionFromHeight(720), '720p');
  assert.equal(getResolutionFromHeight(540), '540p');
  assert.equal(getResolutionFromHeight(360), '360p');
  assert.equal(getResolutionFromHeight(undefined), undefined);
});

test('Viewer adaptive dropdown dynamically adapts to presenter resolution attributes', async t => {
  const remoteTrack = mockScreenTrack(false, { screenShareResolution: '720p' });
  let root;

  await act(async () => {
    root = create(
      React.createElement(ScreenShareStage, {
        tracks: [remoteTrack],
        focused: false,
        showThumbnails: false,
        fullscreen: false,
        fullscreenPending: false,
        fullscreenSupported: true,
        onFocus: () => {},
        onThumbnails: () => {},
        onFullscreen: () => {},
      })
    );
  });
  t.after(async () => { await act(async () => root.unmount()); });

  const qualitySelect = root.root.find(s => s.type === 'select' && s.props['aria-label'] === 'Pilih kualitas penerimaan video');
  assert.ok(qualitySelect);

  const renderedOptions = qualitySelect.findAllByType('option');
  const values = renderedOptions.map(o => o.props.value);
  assert.deepEqual(values, ['720p', '540p', '360p', 'auto']);
  assert.ok(renderedOptions[0].children[0].includes('Maksimal Presenter • HD'));
});

test('Viewer receiveQuality automatically clamps down if presenter lowers resolution mid-call', async t => {
  const remoteTrack = mockScreenTrack(false, { screenShareResolution: '1080p' });
  let root;

  await act(async () => {
    root = create(
      React.createElement(ScreenShareStage, {
        tracks: [remoteTrack],
        focused: false,
        showThumbnails: false,
        fullscreen: false,
        fullscreenPending: false,
        fullscreenSupported: true,
        onFocus: () => {},
        onThumbnails: () => {},
        onFullscreen: () => {},
      })
    );
  });
  t.after(async () => { await act(async () => root.unmount()); });

  let qualitySelect = root.root.find(s => s.type === 'select' && s.props['aria-label'] === 'Pilih kualitas penerimaan video');
  
  // Viewer chooses 1080p
  await act(async () => {
    qualitySelect.props.onChange({ target: { value: '1080p' } });
  });
  qualitySelect = root.root.find(s => s.type === 'select' && s.props['aria-label'] === 'Pilih kualitas penerimaan video');
  assert.equal(qualitySelect.props.value, '1080p');

  // Presenter reduces resolution to 540p
  await act(async () => {
    remoteTrack.participant.attributes = { screenShareResolution: '540p' };
    remoteTrack.participant.emit('attributesChanged', { screenShareResolution: '540p' });
  });

  qualitySelect = root.root.find(s => s.type === 'select' && s.props['aria-label'] === 'Pilih kualitas penerimaan video');
  const values = qualitySelect.findAllByType('option').map(o => o.props.value);
  assert.deepEqual(values, ['540p', '360p', 'auto']);
  // Clamped down to highest available
  assert.equal(qualitySelect.props.value, '540p');
});
