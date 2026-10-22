"""Generates plausibly terrible, generic madlib-style answers and the
scripted mini-conversation threads that follow them.

Runs unmodified under plain CPython (see tests/offline_test.py) and inside
Pyodide in the browser. Relies on NLTK's tokenizer + POS tagger to find real
nouns in the user's question, which get spliced into canned templates.
"""
import json
import random
import re

import nltk


def load_templates(path="data/templates.json"):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def extract_nouns(question):
    tokens = nltk.word_tokenize(question)
    tagged = nltk.pos_tag(tokens)
    nouns = [word for word, tag in tagged if tag.startswith("NN") and word.isalpha()]
    return nouns


def _pick_noun(nouns, fallback_pool, used):
    candidates = [n for n in nouns if n not in used] or nouns
    if candidates:
        choice = random.choice(candidates)
    else:
        choice = random.choice(fallback_pool)
    used.add(choice)
    return choice.lower()


def build_values(question, data, rng=None):
    """Picks one consistent set of filler words for a whole exchange, so the
    bot and the human's follow-ups can keep referencing the same nouns and
    buzzwords instead of each line being independently randomized."""
    rng = rng or random
    nouns = extract_nouns(question)

    used = set()
    noun1 = _pick_noun(nouns, data["buzz_nouns"], used)
    noun2 = _pick_noun(nouns, data["buzz_nouns"], used)

    return {
        "noun1": noun1,
        "noun2": noun2,
        "buzz1": rng.choice(data["buzz_nouns"]),
        "buzz2": rng.choice(data["buzz_nouns"]),
        "adjective1": rng.choice(data["adjectives"]),
        "adjective2": rng.choice(data["adjectives"]),
        "adverb1": rng.choice(data["adverbs"]),
        "verb1": rng.choice(data["verbs"]),
    }


def _capitalize_sentences(text):
    # Capitalize the first letter of the text and of every sentence after
    # a ". " boundary, since lowercase placeholders (adverbs, nouns) can
    # land right after a period.
    return re.sub(
        r"(^|(?<=[.!?]\s))([a-z])",
        lambda m: m.group(1) + m.group(2).upper(),
        text,
    )


def render(template, values):
    return _capitalize_sentences(template.format(**values))


def generate_answer(question, templates=None, rng=None):
    """Standalone one-off answer, using a fresh set of filler values."""
    rng = rng or random
    data = templates or load_templates()
    values = build_values(question, data, rng)
    template = rng.choice(data["templates"])
    return render(template, values)


def generate_opening(question, templates=None, rng=None):
    rng = rng or random
    data = templates or load_templates()
    values = build_values(question, data, rng)
    template = rng.choice(data["templates"])
    return render(template, values)


def generate_mini_conversation(question, templates=None, rng=None, conv_index=None):
    """Returns one scripted human/bot back-and-forth thread, with every line
    drawn from the same filler-value set so the thread stays coherent."""
    rng = rng or random
    data = templates or load_templates()
    conversations = data["mini_conversations"]
    index = conv_index if conv_index is not None else rng.randrange(len(conversations))
    conv = conversations[index % len(conversations)]

    values = build_values(question, data, rng)
    turns = []
    for turn in conv["turns"]:
        template = turn["template"]
        if isinstance(template, list):
            template = rng.choice(template)
        turns.append({"role": turn["role"], "text": render(template, values)})

    return {"id": conv["id"], "index": index, "turns": turns}


def generate_session(question, templates=None, rng=None):
    data = templates or load_templates()
    first_answer = generate_opening(question, data, rng)
    return {"first_answer": first_answer}
