package com.custodysim.app.ui.common

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.layout.LazyLayoutCacheWindow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

/** Prepare half a viewport ahead; retain a small window for reversing direction. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun rememberAppListState(): LazyListState {
    val window = remember { LazyLayoutCacheWindow(aheadFraction = 0.5f, behindFraction = 0.25f) }
    val state = rememberLazyListState(cacheWindow = window)
    return state
}

