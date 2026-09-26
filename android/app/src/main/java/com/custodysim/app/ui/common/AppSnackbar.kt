package com.custodysim.app.ui.common

import androidx.compose.runtime.staticCompositionLocalOf

/** Short operation feedback; durable errors and form validation remain beside their content. */
val LocalAppSnackbar = staticCompositionLocalOf<(String) -> Unit> { {} }
