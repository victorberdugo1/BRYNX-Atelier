#include "json_mini.h"
#include <string.h>
#include <stdlib.h>
#include <ctype.h>

// ============================================================================
// ARENA
// ============================================================================

#define JSON_ARENA_SIZE          (64 * 1024)
#define JSON_MAX_OBJECT_MEMBERS   64 // per-object cap while parsing (stack-local, not the arena)

static char        g_arena[JSON_ARENA_SIZE];
static size_t      g_arenaPos = 0;

static void *ArenaAlloc(size_t size) {
    size = (size + 7u) & ~((size_t)7u); // 8-byte align
    if (g_arenaPos + size > JSON_ARENA_SIZE) return NULL;
    void *ptr = &g_arena[g_arenaPos];
    g_arenaPos += size;
    return ptr;
}

static JsonValue *NewValue(JsonType type) {
    JsonValue *v = (JsonValue *)ArenaAlloc(sizeof(JsonValue));
    if (v) v->type = type;
    return v;
}

// ============================================================================
// LEXER / PARSER STATE
// ============================================================================

typedef struct {
    const char *s;
    size_t pos;
    size_t len;
} Parser;

static void SkipWs(Parser *p) {
    while (p->pos < p->len) {
        char c = p->s[p->pos];
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') p->pos++;
        else break;
    }
}

static char Peek(Parser *p) {
    return (p->pos < p->len) ? p->s[p->pos] : '\0';
}

static JsonValue *ParseValue(Parser *p);

static char *ParseRawString(Parser *p) {
    // assumes Peek(p) == '"'
    p->pos++; // consume opening quote
    size_t start = p->pos;
    // First pass: find end, accounting for escapes.
    size_t i = start;
    int extra = 0;
    while (i < p->len && p->s[i] != '"') {
        if (p->s[i] == '\\' && i + 1 < p->len) {
            i += 2;
            extra++;
        } else {
            i++;
        }
    }
    size_t rawLen = i - start;
    char *out = (char *)ArenaAlloc(rawLen - extra + 1);
    if (!out) { p->pos = i + 1; return NULL; }

    size_t o = 0;
    size_t j = start;
    while (j < i) {
        if (p->s[j] == '\\' && j + 1 < i) {
            char esc = p->s[j + 1];
            switch (esc) {
                case 'n': out[o++] = '\n'; break;
                case 't': out[o++] = '\t'; break;
                case 'r': out[o++] = '\r'; break;
                case '"': out[o++] = '"'; break;
                case '\\': out[o++] = '\\'; break;
                default: out[o++] = esc; break;
            }
            j += 2;
        } else {
            out[o++] = p->s[j++];
        }
    }
    out[o] = '\0';
    p->pos = i + 1; // consume closing quote
    return out;
}

static JsonValue *ParseString(Parser *p) {
    JsonValue *v = NewValue(JSON_STRING);
    char *str = ParseRawString(p);
    if (v) v->as.string = str ? str : "";
    return v;
}

static JsonValue *ParseNumber(Parser *p) {
    size_t start = p->pos;
    if (Peek(p) == '-' || Peek(p) == '+') p->pos++;
    while (p->pos < p->len && (isdigit((unsigned char)p->s[p->pos]) || p->s[p->pos] == '.' ||
                                 p->s[p->pos] == 'e' || p->s[p->pos] == 'E' ||
                                 p->s[p->pos] == '-' || p->s[p->pos] == '+')) {
        p->pos++;
    }
    size_t len = p->pos - start;
    char buf[64];
    if (len >= sizeof(buf)) len = sizeof(buf) - 1;
    memcpy(buf, p->s + start, len);
    buf[len] = '\0';

    JsonValue *v = NewValue(JSON_NUMBER);
    if (v) v->as.number = atof(buf);
    return v;
}

static JsonValue *ParseLiteral(Parser *p) {
    if (strncmp(p->s + p->pos, "true", 4) == 0) {
        p->pos += 4;
        JsonValue *v = NewValue(JSON_BOOL);
        if (v) v->as.boolean = true;
        return v;
    }
    if (strncmp(p->s + p->pos, "false", 5) == 0) {
        p->pos += 5;
        JsonValue *v = NewValue(JSON_BOOL);
        if (v) v->as.boolean = false;
        return v;
    }
    if (strncmp(p->s + p->pos, "null", 4) == 0) {
        p->pos += 4;
        return NewValue(JSON_NULL);
    }
    // Unknown token — bail out safely.
    p->pos++;
    return NewValue(JSON_NULL);
}

static JsonValue *ParseObject(Parser *p) {
    p->pos++; // consume '{'
    JsonValue *obj = NewValue(JSON_OBJECT);
    if (!obj) return NULL;

    // Collected in a stack-local buffer first, NOT written into the arena as
    // we go. A member's value can itself be a nested object, and parsing
    // that nested object allocates its own member block from the same
    // arena — if we'd already reserved this object's block up front, the
    // recursive call would carve its slots out of the middle of it,
    // desyncing this object's {key,value} pairs from their arena slots.
    // Reserving this object's block only after every value (including
    // nested ones) has finished parsing keeps it contiguous and correct.
    JsonMember local[JSON_MAX_OBJECT_MEMBERS];
    int count = 0;

    SkipWs(p);
    if (Peek(p) == '}') {
        p->pos++;
        obj->as.object.members = NULL;
        obj->as.object.count = 0;
        return obj;
    }

    while (p->pos < p->len) {
        SkipWs(p);
        if (Peek(p) != '"') break;
        char *key = ParseRawString(p);
        SkipWs(p);
        if (Peek(p) == ':') p->pos++;
        SkipWs(p);
        JsonValue *val = ParseValue(p);

        if (count < JSON_MAX_OBJECT_MEMBERS) {
            local[count].key = key;
            local[count].value = val;
            count++;
        }

        SkipWs(p);
        if (Peek(p) == ',') {
            p->pos++;
            continue;
        }
        break;
    }
    SkipWs(p);
    if (Peek(p) == '}') p->pos++;

    JsonMember *members = NULL;
    if (count > 0) {
        members = (JsonMember *)ArenaAlloc(sizeof(JsonMember) * (size_t)count);
        if (members) memcpy(members, local, sizeof(JsonMember) * (size_t)count);
        else count = 0; // arena exhausted — degrade to an empty object rather than a dangling pointer
    }

    obj->as.object.members = members;
    obj->as.object.count = count;
    return obj;
}

static JsonValue *ParseArray(Parser *p) {
    // Arrays are skipped structurally (not needed for the flat effect-params
    // contract) but still consumed so parsing of sibling fields can continue.
    p->pos++; // consume '['
    int depth = 1;
    while (p->pos < p->len && depth > 0) {
        char c = p->s[p->pos];
        if (c == '[') depth++;
        else if (c == ']') depth--;
        else if (c == '"') { ParseRawString(p); continue; }
        p->pos++;
    }
    return NewValue(JSON_NULL);
}

static JsonValue *ParseValue(Parser *p) {
    SkipWs(p);
    char c = Peek(p);
    if (c == '"') return ParseString(p);
    if (c == '{') return ParseObject(p);
    if (c == '[') return ParseArray(p);
    if (c == '-' || c == '+' || isdigit((unsigned char)c)) return ParseNumber(p);
    return ParseLiteral(p);
}

JsonValue *JsonParse(const char *text) {
    g_arenaPos = 0;
    if (!text) return NULL;

    Parser p = { text, 0, strlen(text) };
    SkipWs(&p);
    return ParseValue(&p);
}

JsonValue *JsonObjectGet(const JsonValue *obj, const char *key) {
    if (!obj || obj->type != JSON_OBJECT) return NULL;
    for (int i = 0; i < obj->as.object.count; i++) {
        if (strcmp(obj->as.object.members[i].key, key) == 0) {
            return obj->as.object.members[i].value;
        }
    }
    return NULL;
}

double JsonAsNumber(const JsonValue *v, double fallback) {
    if (!v || v->type != JSON_NUMBER) return fallback;
    return v->as.number;
}

bool JsonAsBool(const JsonValue *v, bool fallback) {
    if (!v || v->type != JSON_BOOL) return fallback;
    return v->as.boolean;
}

const char *JsonAsString(const JsonValue *v, const char *fallback) {
    if (!v || v->type != JSON_STRING) return fallback;
    return v->as.string;
}
