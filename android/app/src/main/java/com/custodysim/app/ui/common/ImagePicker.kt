package com.custodysim.app.ui.common

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import com.custodysim.app.data.media.ImagePipeline
import kotlinx.coroutines.launch

/** 系统相册选图 + 压缩成 data URL 的统一入口。返回触发函数，选中后压缩并回调。 */
@Composable
fun rememberImagePicker(
    maxItems: Int = 1,
    onPicked: (List<String>) -> Unit,
): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val single = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val url = ImagePipeline.compressToDataUrl(context, uri)
            if (url != null) onPicked(listOf(url))
        }
    }

    val multiple = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(maxItems.coerceAtLeast(2)),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val urls = uris.mapNotNull { ImagePipeline.compressToDataUrl(context, it) }
            if (urls.isNotEmpty()) onPicked(urls)
        }
    }

    return {
        val request = PickVisualMediaRequest(
            ActivityResultContracts.PickVisualMedia.ImageOnly,
        )
        if (maxItems <= 1) single.launch(request) else multiple.launch(request)
    }
}
