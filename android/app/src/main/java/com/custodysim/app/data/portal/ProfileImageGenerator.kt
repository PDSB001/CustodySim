package com.custodysim.app.data.portal

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Generates the same kind of portable archive image as the web client. */
object ProfileImageGenerator {
    fun saveIdentityPng(context: Context, record: ProfileRecord): Uri? {
        val width = 1200
        val height = 756
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(0xfff7f9ff.toInt())
        canvas.drawRect(24f, 24f, 1176f, 732f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffffffff.toInt() })
        canvas.drawRect(24f, 24f, 1176f, 160f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff2648b5.toInt() })
        text(canvas, "在押人员身份牌", 76f, 94f, 38f, 0xffffffff.toInt(), true, Paint.Align.LEFT)
        val photo = decodeImage(record.photoData)
        if (photo != null) {
            canvas.drawBitmap(photo, null, android.graphics.Rect(76, 204, 354, 554), Paint(Paint.ANTI_ALIAS_FLAG)); photo.recycle()
        } else {
            canvas.drawRect(76f, 204f, 354f, 554f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffe8efff.toInt() })
            text(canvas, "暂无照片", 215f, 390f, 26f, 0xff4664ad.toInt(), true, Paint.Align.CENTER)
        }
        text(canvas, "姓名", 416f, 256f, 20f, 0xff607197.toInt(), false, Paint.Align.LEFT)
        text(canvas, record.userName.ifBlank { "未填写" }, 416f, 314f, 54f, 0xff16233f.toInt(), true, Paint.Align.LEFT)
        text(canvas, "编号", 416f, 390f, 20f, 0xff607197.toInt(), false, Paint.Align.LEFT)
        text(canvas, record.code ?: "待分配", 416f, 430f, 30f, 0xff16233f.toInt(), true, Paint.Align.LEFT)
        text(canvas, "档案分卷", 416f, 500f, 20f, 0xff607197.toInt(), false, Paint.Align.LEFT)
        text(canvas, record.formName, 416f, 540f, 30f, 0xff16233f.toInt(), true, Paint.Align.LEFT)
        text(canvas, "系统生成图片副本", 76f, 662f, 18f, 0xff8490aa.toInt(), false, Paint.Align.LEFT)
        return writePng(context, bitmap, "${record.userName}-身份牌.png")
    }

    fun saveArchivePng(context: Context, record: ProfileRecord): Uri? {
        val rows = record.fields.map { field ->
            field.name to displayValue(record.data.opt(field.name))
        }
        val rowHeight = 92
        val width = 1240
        val height = (520 + rows.size * rowHeight + 250).coerceAtLeast(1500)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val background = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xfff5f6fa.toInt() }
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), background)
        val panel = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffffffff.toInt() }
        canvas.drawRect(48f, 48f, (width - 48).toFloat(), (height - 48).toFloat(), panel)
        val header = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff213e91.toInt() }
        canvas.drawRect(48f, 48f, (width - 48).toFloat(), 222f, header)
        text(canvas, "在押档案信息副本", width / 2f, 120f, 42f, 0xffffffff.toInt(), true, Paint.Align.CENTER)
        text(canvas, record.formName, width / 2f, 166f, 20f, 0xffcdd9ff.toInt(), false, Paint.Align.CENTER)

        val photo = decodeImage(record.photoData)
        if (photo != null) {
            val target = android.graphics.Rect(92, 274, 304, 486)
            canvas.drawBitmap(photo, null, target, Paint(Paint.ANTI_ALIAS_FLAG))
            photo.recycle()
        } else {
            val placeholder = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffe8efff.toInt() }
            canvas.drawRect(92f, 274f, 304f, 486f, placeholder)
            text(canvas, "暂无照片", 198f, 390f, 24f, 0xff4664ad.toInt(), true, Paint.Align.CENTER)
        }
        text(canvas, "姓名", 350f, 314f, 22f, 0xff69758b.toInt(), false, Paint.Align.LEFT)
        text(canvas, record.userName.ifBlank { "未填写" }, 350f, 362f, 38f, 0xff16233f.toInt(), true, Paint.Align.LEFT)
        text(canvas, "档案编号", 350f, 424f, 22f, 0xff69758b.toInt(), false, Paint.Align.LEFT)
        text(canvas, record.code ?: "未归档", 510f, 424f, 25f, 0xff16233f.toInt(), true, Paint.Align.LEFT)
        text(canvas, "状态", 350f, 470f, 22f, 0xff69758b.toInt(), false, Paint.Align.LEFT)
        text(canvas, statusLabel(record.status), 510f, 470f, 25f, 0xff16233f.toInt(), true, Paint.Align.LEFT)

        rows.forEachIndexed { index, (label, value) ->
            val y = 520 + index * rowHeight
            val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffdbe0ea.toInt(); strokeWidth = 2f }
            canvas.drawLine(92f, (y + 70).toFloat(), 1148f, (y + 70).toFloat(), line)
            text(canvas, label, 112f, (y + 32).toFloat(), 23f, 0xff69758b.toInt(), true, Paint.Align.LEFT)
            text(canvas, value, 350f, (y + 32).toFloat(), 25f, 0xff16233f.toInt(), false, Paint.Align.LEFT)
        }
        val footerY = 520 + rows.size * rowHeight + 24
        decodeImage(record.signatureData)?.let { signature ->
            canvas.drawBitmap(signature, null, android.graphics.Rect(96, footerY, 336, footerY + 100), Paint(Paint.ANTI_ALIAS_FLAG))
            signature.recycle()
        }
        decodeImage(record.officialSealData)?.let { seal ->
            canvas.drawBitmap(seal, null, android.graphics.Rect(920, footerY - 16, 1070, footerY + 134), Paint(Paint.ANTI_ALIAS_FLAG))
            seal.recycle()
        }
        text(canvas, "系统生成图片副本 · ${SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).format(Date())}", 92f, (height - 76).toFloat(), 18f, 0xff8490a6.toInt(), false, Paint.Align.LEFT)

        return writePng(context, bitmap, "${record.userName}-${record.formName}-档案.png")
    }

    private fun writePng(context: Context, bitmap: Bitmap, fileName: String): Uri? {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            if (Build.VERSION.SDK_INT >= 29) {
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/CustodySim")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        }
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return null
        return try {
            resolver.openOutputStream(uri)?.use { output -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, output) }
            if (Build.VERSION.SDK_INT >= 29) resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
            bitmap.recycle()
            uri
        } catch (_: Exception) {
            resolver.delete(uri, null, null)
            bitmap.recycle()
            null
        }
    }

    private fun displayValue(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "未填写"
        is String -> if (value.isBlank()) "未填写" else value
        else -> value.toString()
    }

    private fun statusLabel(status: String): String = when (status) {
        "DRAFT" -> "草稿"
        "PENDING_REVIEW" -> "会签中"
        "RETURNED" -> "已退回"
        "LOCKED" -> "已归档"
        else -> status.ifBlank { "未知" }
    }

    private fun decodeImage(data: String?): Bitmap? {
        if (data.isNullOrBlank()) return null
        return try {
            val encoded = data.substringAfter(',', data)
            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Exception) { null }
    }

    private fun text(canvas: Canvas, value: String, x: Float, y: Float, size: Float, color: Int, bold: Boolean, align: Paint.Align) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color; textSize = size; textAlign = align
            typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        }
        canvas.drawText(value.take(44), x, y, paint)
    }
}
