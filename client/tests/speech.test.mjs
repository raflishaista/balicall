import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { startSpeechRecognition } from '../src/speechRecognition.ts';
import { useSpeechTranscription } from '../src/useSpeechTranscription.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class FakeRecognition {
  static instances = [];
  starts = 0;
  aborts = 0;
  constructor() { FakeRecognition.instances.push(this); }
  start() { this.starts++; }
  abort() { this.aborts++; this.onend?.(); }
  stop() { this.onend?.(); }
  final(text) { this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] }); }
}

function setup() {
  const recognition = new FakeRecognition();
  const values = { listening: false, interim: '', finals: [], errors: [] };
  const dispose = startSpeechRecognition(recognition, {
    language: 'id-ID',
    onListening: value => { values.listening = value; },
    onInterim: value => { values.interim = value; },
    onFinal: value => values.finals.push(value),
    onError: value => values.errors.push(value),
  });
  return { recognition, values, dispose };
}

test('active status waits for real start; only final speech is saved', () => {
  const { recognition, values, dispose } = setup();
  assert.equal(values.listening, false);
  recognition.onstart();
  assert.equal(values.listening, true);
  recognition.onresult({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'halo' } }] });
  assert.equal(values.interim, 'halo');
  assert.deepEqual(values.finals, []);
  recognition.final('  rapat dimulai  ');
  assert.deepEqual(values.finals, ['rapat dimulai']);
  assert.equal(values.interim, '');
  dispose();
});

test('recognition restarts after natural end and no-speech', async () => {
  const { recognition, dispose } = setup();
  recognition.onstart();
  recognition.onerror({ error: 'no-speech' });
  recognition.onend();
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(recognition.starts, 2);
  dispose();
});

for (const error of ['network', 'not-allowed', 'service-not-allowed', 'audio-capture']) {
  test(`${error} stops listening without an automatic retry loop`, async () => {
    const { recognition, values, dispose } = setup();
    recognition.onstart();
    recognition.onerror({ error });
    recognition.onend();
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(values.listening, false);
    assert.equal(values.errors.length, 1);
    assert.equal(recognition.starts, 1);
    dispose();
  });
}

test('cleanup cancels pending restart and ignores queued events', async () => {
  const { recognition, values, dispose } = setup();
  const lateResult = recognition.onresult;
  recognition.onend();
  dispose();
  lateResult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late' } }] });
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(recognition.starts, 1);
  assert.equal(recognition.aborts, 1);
  assert.deepEqual(values.finals, []);
});

test('synchronous start failures are visible', () => {
  const recognition = new FakeRecognition();
  recognition.start = () => { throw new Error('device unavailable'); };
  const errors = [];
  const dispose = startSpeechRecognition(recognition, {
    language: 'id-ID', onListening() {}, onInterim() {}, onFinal() {},
    onError: message => errors.push(message),
  });
  assert.match(errors[0], /device unavailable/);
  dispose();
});

test('finishing recognition captures the final result before allowing summary', async () => {
  const { recognition, values, dispose } = setup();
  recognition.onstart();
  recognition.stop = () => { recognition.final('ucapan terakhir'); recognition.onend(); };
  await dispose.finish();
  assert.deepEqual(values.finals, ['ucapan terakhir']);
  assert.equal(values.listening, false);
  dispose();
});

test('repeated final result events do not save the same sentence twice', () => {
  const { recognition, values, dispose } = setup();
  recognition.onstart(); recognition.final('one sentence'); recognition.final('one sentence');
  assert.deepEqual(values.finals, ['one sentence']);
  dispose();
});

test('React rerenders preserve the recognizer and use the latest callback; mute aborts it', async () => {
  FakeRecognition.instances = [];
  globalThis.window = { webkitSpeechRecognition: FakeRecognition };
  let state;
  function Harness(props) {
    const value = useSpeechTranscription(props);
    React.useEffect(() => { state = value; });
    return null;
  }
  const first = [], latest = [];
  let root;
  await act(async () => { root = create(React.createElement(Harness, { language: 'id-ID', muted: false, onFinal: text => first.push(text) })); });
  const recognition = FakeRecognition.instances[0];
  await act(async () => recognition.onstart());
  for (let i = 0; i < 10; i++) {
    await act(async () => root.update(React.createElement(Harness, { language: 'id-ID', muted: false, onFinal: text => latest.push(text) })));
  }
  assert.equal(FakeRecognition.instances.length, 1);
  assert.equal(recognition.aborts, 0);
  await act(async () => recognition.final('suara menjadi teks'));
  assert.deepEqual(first, []);
  assert.deepEqual(latest, ['suara menjadi teks']);
  await act(async () => root.update(React.createElement(Harness, { language: 'id-ID', muted: true, onFinal() {} })));
  assert.equal(recognition.aborts, 1);
  assert.equal(state.isListeningSpeechApi, false);
  await act(async () => root.unmount());
});

test('stop stays stopped, error can be retried, and language change replaces the recognizer', async () => {
  FakeRecognition.instances = [];
  globalThis.window = { SpeechRecognition: FakeRecognition };
  let state, root;
  function Harness(props) {
    const value = useSpeechTranscription(props);
    React.useEffect(() => { state = value; });
    return null;
  }
  const props = { language: 'id-ID', muted: false, onFinal() {} };
  await act(async () => { root = create(React.createElement(Harness, props)); });
  let recognition = FakeRecognition.instances[0];
  await act(async () => recognition.onstart());
  await act(async () => state.toggleSpeechRecognition());
  assert.equal(recognition.aborts, 1);
  await act(async () => root.update(React.createElement(Harness, { ...props, onFinal() {} })));
  assert.equal(FakeRecognition.instances.length, 1);
  await act(async () => state.toggleSpeechRecognition());
  recognition = FakeRecognition.instances[1];
  await act(async () => { recognition.onstart(); recognition.onerror({ error: 'network' }); recognition.onend(); });
  assert.match(state.speechError, /network/);
  assert.equal(state.isListeningSpeechApi, false);
  await act(async () => state.toggleSpeechRecognition());
  assert.equal(FakeRecognition.instances.length, 3);
  await act(async () => root.update(React.createElement(Harness, { ...props, language: 'en-US' })));
  assert.equal(FakeRecognition.instances.at(-1).lang, 'en-US');
  await act(async () => root.unmount());
});
