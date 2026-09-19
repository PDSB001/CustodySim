package com.custodysim.app

import android.app.Application

/**
 * 应用入口。这里只做一件事：把依赖容器建起来。
 *
 * 没上 DI 框架（Hilt/Koin）：当前依赖图只有一层，手写容器更直观，
 * 也省掉注解处理器带来的构建复杂度。
 */
class CustodySimApp : Application() {

    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
