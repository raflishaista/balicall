"""Assign word timestamps to the speaker with the greatest temporal overlap."""


def align_words(words, turns):
    segments = []
    for word in words:
        start, end, text = word
        overlaps = [(max(0, min(end, stop) - max(start, begin)), speaker)
                    for begin, stop, speaker in turns]
        overlap, speaker = max(overlaps, default=(0, "UNKNOWN"))
        if overlap <= 0:
            speaker = "UNKNOWN"
        if segments and segments[-1]["speaker"] == speaker:
            segments[-1]["text"] += text
            segments[-1]["end"] = end
        else:
            segments.append(dict(start=start, end=end, speaker=speaker, text=text))
    for segment in segments:
        segment["text"] = segment["text"].strip()
    return [segment for segment in segments if segment["text"]]
