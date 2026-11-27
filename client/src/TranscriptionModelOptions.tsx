import {modelOptions} from './modelSelection';
import {transcriptionModelDescription, transcriptionModelLabel} from './preferences';

export function TranscriptionModelOptions({models}: {models:string[]}) {
  return <>{modelOptions(models).map(({model,disabled}) =>
    <option key={model} value={model} disabled={disabled} title={transcriptionModelDescription(model) || undefined}>
      {transcriptionModelLabel(model)}{disabled ? ' · belum tersedia' : ''}
    </option>)}</>;
}
