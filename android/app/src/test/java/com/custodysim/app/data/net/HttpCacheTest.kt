package com.custodysim.app.data.net

import okhttp3.Cache
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.Proxy
import java.net.Socket
import java.net.SocketAddress
import javax.net.SocketFactory

class HttpCacheTest {
    @get:Rule val temp = TemporaryFolder()

    // Exercise OkHttp's real HTTP/cache pipeline using only in-memory socket streams.
    // No listening server, DNS lookup, device, or real network is required.
    private class MemorySockets(private val cacheControl: String) : SocketFactory() {
        var connections = 0
        override fun createSocket(): Socket = object : Socket() {
            private val response = ByteArrayInputStream((
                "HTTP/1.1 200 OK\r\n" +
                    "Content-Type: image/png\r\n" +
                    "Content-Length: 5\r\n" +
                    "Cache-Control: $cacheControl\r\n" +
                    "Vary: Cookie, Authorization\r\n" +
                    "Connection: close\r\n\r\nimage"
                ).toByteArray(Charsets.UTF_8))
            private val output = ByteArrayOutputStream()
            override fun connect(endpoint: SocketAddress, timeout: Int) { connections++ }
            override fun getInputStream() = response
            override fun getOutputStream() = output
        }
        override fun createSocket(host: String, port: Int): Socket = error("Unexpected overload")
        override fun createSocket(host: String, port: Int, local: InetAddress, localPort: Int): Socket = error("Unexpected overload")
        override fun createSocket(host: InetAddress, port: Int): Socket = error("Unexpected overload")
        override fun createSocket(host: InetAddress, port: Int, local: InetAddress, localPort: Int): Socket = error("Unexpected overload")
    }

    private fun client(cache: Cache, sockets: MemorySockets) = OkHttpClient.Builder()
        .cache(cache)
        .socketFactory(sockets)
        .proxy(Proxy.NO_PROXY)
        .dns(object : Dns {
            override fun lookup(hostname: String) = listOf(InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)))
        })
        .build()

    private fun get(client: OkHttpClient, token: String = "one", host: String = "one.test", cached: Boolean) {
        val request = Request.Builder().url("http://$host/api/chat/messages/id/image")
            .header("Authorization", "Bearer $token").build()
        client.newCall(request).execute().use {
            assertEquals("image", it.body!!.string()) // Fully consume body to commit the cache entry.
            assertEquals(cached, it.cacheResponse != null)
            assertEquals(!cached, it.networkResponse != null)
        }
    }

    @Test fun `fresh image survives cache close and reopen without another connection`() {
        val directory = temp.newFolder()
        val sockets = MemorySockets("private, max-age=31536000, immutable")
        createHttpCache(directory).use { cache ->
            assertEquals(25L * 1024 * 1024, cache.maxSize())
            val client = client(cache, sockets)
            get(client, cached = false)
            get(client, cached = true)
        }
        createHttpCache(directory).use { cache -> get(client(cache, sockets), cached = true) }
        assertEquals(1, sockets.connections)
    }

    @Test fun `no-store response is never reused`() {
        val sockets = MemorySockets("private, no-store")
        createHttpCache(temp.newFolder()).use { cache ->
            val client = client(cache, sockets)
            repeat(2) { get(client, cached = false) }
        }
        assertEquals(2, sockets.connections)
    }

    @Test fun `different bearer token or server cannot reuse an image`() {
        val sockets = MemorySockets("private, max-age=31536000, immutable")
        createHttpCache(temp.newFolder()).use { cache ->
            val client = client(cache, sockets)
            get(client, cached = false)
            get(client, token = "two", cached = false)
            get(client, token = "two", cached = true)
            get(client, token = "two", host = "two.test", cached = false)
        }
        assertEquals(3, sockets.connections)
    }
}
