import {modelOptions} from './modelSelection';
import {transcriptionModelLabel} from './preferences';

export function TranscriptionModelOptions({models}: {models:string[]}) {
  return <>{modelOptions(models).map(({model,disabled}) =>
    <option key={model} value={model} disabled={disabled}>
      {transcriptionModelLabel(model)}{disabled ? ' · belum tersedia' : ''}
    </option>)}</>;
}
