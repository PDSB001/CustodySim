package com.custodysim.app.ui.common

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import top.yukonga.miuix.kmp.basic.Text
import top.yukonga.miuix.kmp.theme.MiuixTheme

@Composable
fun UserAvatar(name: String, avatar: String?, modifier: Modifier = Modifier, size: Dp = 44.dp) {
    val bitmap = rememberDataUrlImage(avatar)
    Box(modifier.size(size).clip(CircleShape).background(MiuixTheme.colorScheme.primary.copy(alpha = 0.10f)),
        contentAlignment = Alignment.Center) {
        if (bitmap != null) Image(bitmap, "$name 的头像", Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Text(name.take(1).ifBlank { "?" }, color = MiuixTheme.colorScheme.primary,
            style = MiuixTheme.textStyles.title2)
    }
}
