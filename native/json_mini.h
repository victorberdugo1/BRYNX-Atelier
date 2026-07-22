#ifndef JSON_MINI_H
#define JSON_MINI_H

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    JSON_NULL,
    JSON_BOOL,
    JSON_NUMBER,
    JSON_STRING,
    JSON_OBJECT
} JsonType;

typedef struct JsonValue JsonValue;

typedef struct {
    char *key;
    JsonValue *value;
} JsonMember;

struct JsonValue {
    JsonType type;
    union {
        bool boolean;
        double number;
        char *string;
        struct {
            JsonMember *members;
            int count;
        } object;
    } as;
};

// Parses `text` into a JsonValue tree. Backed by a fixed internal arena that is
// reset on every call — the returned pointer (and everything reachable from
// it) is only valid until the next JsonParse() call. This keeps the parser
// allocation-free, which matters inside an Emscripten module with no libc
// heap tuning.
JsonValue *JsonParse(const char *text);

// Object field lookup — returns NULL if `obj` isn't an object or the key is
// absent.
JsonValue *JsonObjectGet(const JsonValue *obj, const char *key);

double JsonAsNumber(const JsonValue *v, double fallback);
bool JsonAsBool(const JsonValue *v, bool fallback);
const char *JsonAsString(const JsonValue *v, const char *fallback);

#ifdef __cplusplus
}
#endif

#endif // JSON_MINI_H
