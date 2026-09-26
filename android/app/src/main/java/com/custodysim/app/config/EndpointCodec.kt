package com.custodysim.app.config

/** Obfuscation, not encryption. Runtime addresses are necessarily observable. */
object EndpointCodec {
    fun decode(value: String): String {
        if (value.isEmpty()) return ""
        return value.split(',').mapIndexed { index, part ->
            (part.toInt() xor ((index * 31 + 167) and 255)).toByte()
        }.toByteArray().toString(Charsets.UTF_8)
    }
}
