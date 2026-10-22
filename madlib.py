"""Generates plausibly terrible, generic madlib-style answers.

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


def generate_answer(question, templates=None, rng=None):
    rng = rng or random
    data = templates or load_templates()
    nouns = extract_nouns(question)

    used = set()
    noun1 = _pick_noun(nouns, data["buzz_nouns"], used)
    noun2 = _pick_noun(nouns, data["buzz_nouns"], used)

    template = rng.choice(data["templates"])
    answer = template.format(
        noun1=noun1,
        noun2=noun2,
        adjective1=rng.choice(data["adjectives"]),
        adjective2=rng.choice(data["adjectives"]),
        adverb1=rng.choice(data["adverbs"]),
        buzz1=rng.choice(data["buzz_nouns"]),
        buzz2=rng.choice(data["buzz_nouns"]),
        verb1=rng.choice(data["verbs"]),
    )
    # Capitalize the first letter of the answer and of every sentence after
    # a ". " boundary, since lowercase placeholders (adverbs, nouns) can
    # land right after a period.
    answer = re.sub(
        r"(^|(?<=[.!?]\s))([a-z])",
        lambda m: m.group(1) + m.group(2).upper(),
        answer,
    )
    return answer


def get_no_variants(templates=None):
    data = templates or load_templates()
    return list(data["no_variants"])


def generate_session(question, templates=None, rng=None):
    """Returns the first answer plus the escalating 'No!' + follow-up answer pairs."""
    data = templates or load_templates()
    first_answer = generate_answer(question, data, rng)
    no_variants = get_no_variants(data)
    follow_ups = [generate_answer(question, data, rng) for _ in no_variants]
    return {
        "first_answer": first_answer,
        "exchanges": list(zip(no_variants, follow_ups)),
    }
