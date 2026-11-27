import {modelOptions} from './modelSelection';
import {transcriptionModelDescription, transcriptionModelLabel, transcriptionModelShortTag} from './preferences';

export function TranscriptionModelOptions({models}: {models:string[]}) {
  return <>{modelOptions(models).map(({model,disabled}) => {
    const tag = transcriptionModelShortTag(model);
    return (
      <option key={model} value={model} disabled={disabled} title={transcriptionModelDescription(model) || undefined}>
        {transcriptionModelLabel(model)}{tag ? ` (${tag})` : ''}{disabled ? ' · belum tersedia' : ''}
      </option>
    );
  })}</>;
}
