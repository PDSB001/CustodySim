package com.custodysim.app.data.portal

import androidx.core.graphics.createBitmap
import androidx.core.graphics.withSave
import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 生成身份牌 / 档案图片副本。
 *
 * 画布尺寸、每个坐标、字号、颜色、行高都对着 Web 端
 * `components/profile-records/profile-image-actions.tsx` 里的 SVG 抄，保证两端导出的图一致；
 * 以后改这里请同步改 Web 端，反之亦然。
 */
object ProfileImageGenerator {

    /** 画布上最大也就 278×350，按原图（上传管线可到 1600px）解码纯属浪费。 */
    private const val MAX_SOURCE_PX = 1024

    private const val IDENTITY_TIME_PATTERN = "yyyy/M/d"
    private const val ARCHIVE_TIME_PATTERN = "yyyy/M/d HH:mm:ss"

    // ---------------------------------------------------------------- 身份牌

    /** 1200×756，与 Web 端 identitySvg 一一对应。 */
    fun saveIdentityPng(context: Context, record: ProfileRecord, summary: ProfileSummary?): Uri? {
        val width = 1200
        val height = 756
        val bitmap = createBitmap(width, height)
        val canvas = Canvas(bitmap)
        canvas.drawColor(0xfff7f9ff.toInt())
        fillRoundRect(canvas, 24f, 24f, 1176f, 732f, 28f, 0xffffffff.toInt())
        // 页眉只圆上面两角：先画圆角矩形，再用方角矩形把下面两角压平。
        fillRoundRect(canvas, 24f, 24f, 1176f, 140f, 28f, 0xff2648b5.toInt())
        fillRect(canvas, 24f, 52f, 1176f, 140f, 0xff2648b5.toInt())
        text(canvas, "在押人员身份牌", 76f, 94f, 38f, 0xffffffff.toInt(), true, Paint.Align.LEFT, letterSpacingPx = 3f)
        text(canvas, "CUSTODY SIM", 1124f, 92f, 18f, 0xffc9d7ff.toInt(), false, Paint.Align.RIGHT, letterSpacingPx = 2f)

        // 有本人监管摘要时按 Web 端展示「所在监室」；拿不到摘要时（该接口只允许被监管人查本人，
        // 监管员看别人的档案会 403）退回记录自带的档案分卷，避免把人误报成「未分配」。
        val number: String
        val secondLabel: String
        val secondValue: String
        val level: String
        if (summary != null) {
            number = summary.number ?: "待分配"
            secondLabel = "所在监室"
            secondValue = summary.organizationPath ?: "未分配"
            level = summary.custodyLevelLabel ?: "普管"
        } else {
            number = record.code ?: "待分配"
            secondLabel = "档案分卷"
            secondValue = record.formName
            level = "普管"
        }

        fillRoundRect(canvas, 76f, 204f, 354f, 554f, 18f, 0xffedf2ff.toInt())
        strokeRoundRect(canvas, 76f, 204f, 354f, 554f, 18f, 0xffc8d5ff.toInt(), 2f)
        val photo = decodeImage(record.photoData)
        if (photo != null) {
            drawImageSliced(canvas, photo, 88f, 216f, 254f, 326f, 12f)
            photo.recycle()
        } else {
            avatarPlaceholder(canvas, 88f, 216f, 254f, 326f)
        }

        text(canvas, "姓名", 416f, 256f, 20f, 0xff607197.toInt(), false, Paint.Align.LEFT, letterSpacingPx = 2f)
        textBlock(canvas, record.userName, 416f, 314f, 12, 54f, 0xff16233f.toInt(), 40f, bold = true)
        text(canvas, "编号", 416f, 390f, 20f, 0xff607197.toInt(), false, Paint.Align.LEFT, letterSpacingPx = 2f)
        textBlock(canvas, number, 416f, 430f, 24, 30f, 0xff16233f.toInt(), 40f)
        text(canvas, secondLabel, 416f, 500f, 20f, 0xff607197.toInt(), false, Paint.Align.LEFT, letterSpacingPx = 2f)
        textBlock(canvas, secondValue, 416f, 540f, 24, 30f, 0xff16233f.toInt(), 40f)

        fillRoundRect(canvas, 904f, 430f, 1100f, 502f, 36f, 0xffe4edff.toInt())
        text(canvas, level, 1002f, 476f, 26f, 0xff2648b5.toInt(), true, Paint.Align.CENTER)

        text(canvas, "本身份牌为系统生成副本，请结合当前监管记录核验。", 76f, 662f, 18f, 0xff8490aa.toInt(), false, Paint.Align.LEFT)
        text(canvas, SimpleDateFormat(IDENTITY_TIME_PATTERN, Locale.CHINA).format(Date()), 1124f, 662f, 18f, 0xff8490aa.toInt(), false, Paint.Align.RIGHT)

        return writePng(context, bitmap, "${record.userName}-身份牌.png")
    }

    // ---------------------------------------------------------------- 档案副本

    /** 1240×max(1754, 520+行数×110+250)，与 Web 端 archiveSvg 一一对应。 */
    fun saveArchivePng(context: Context, record: ProfileRecord, summary: ProfileSummary?): Uri? {
        val rows = record.fields.map { field ->
            field.name to displayValue(record.data.opt(field.name))
        }
        val rowHeight = 110
        val contentStart = 520
        val width = 1240
        // 字段行最多排两行文字：起始 y+34、行高 31，第二行落在 y+65，行分隔线在 y+82，放得下。
        val rowMaxLines = 2
        // 标签列 x=112 到值列 x=350 只有 238px（字号 23 约 10 字），值列到右边界 1148 有 798px
        // （字号 25 约 30 字）。超出的按 … 截断，否则长标签会直接压在内容上。
        val labelMaxCharacters = 10
        val valueMaxCharacters = 30
        val footerY = contentStart + rows.size * rowHeight + 96
        // 页脚要放下公章(150)、签名(100)与说明文字：footerY 到底边至少留 8 + 150 + 40 + 76。
        val height = maxOf(1754, footerY + 274)
        val footerTextY = height - 76
        val signatureY = footerTextY - 140
        val sealY = footerTextY - 190
        val bitmap = createBitmap(width, height)
        val canvas = Canvas(bitmap)
        canvas.drawColor(0xfff5f6fa.toInt())
        fillRect(canvas, 48f, 48f, 1192f, (height - 48).toFloat(), 0xffffffff.toInt())
        strokeRect(canvas, 48f, 48f, 1192f, (height - 48).toFloat(), 0xffccd3e1.toInt(), 2f)
        fillRect(canvas, 48f, 48f, 1192f, 222f, 0xff213e91.toInt())
        text(canvas, "在押档案信息副本", 620f, 120f, 42f, 0xffffffff.toInt(), true, Paint.Align.CENTER, letterSpacingPx = 4f)
        text(canvas, record.formName, 620f, 164f, 20f, 0xffcdd9ff.toInt(), false, Paint.Align.CENTER)

        fillRoundRect(canvas, 92f, 274f, 304f, 486f, 8f, 0xffedf1f8.toInt())
        strokeRoundRect(canvas, 92f, 274f, 304f, 486f, 8f, 0xffcdd5e4.toInt(), 1f)
        val photo = decodeImage(record.photoData)
        if (photo != null) {
            drawImageSliced(canvas, photo, 100f, 282f, 196f, 196f, 6f)
            photo.recycle()
        } else {
            avatarPlaceholder(canvas, 100f, 282f, 196f, 196f)
        }

        text(canvas, "姓名", 350f, 314f, 22f, 0xff69758b.toInt(), false, Paint.Align.LEFT)
        textBlock(canvas, record.userName, 350f, 362f, 16, 38f, 0xff16233f.toInt(), 40f, bold = true)
        text(canvas, "档案编号", 350f, 424f, 22f, 0xff69758b.toInt(), false, Paint.Align.LEFT)
        textBlock(canvas, record.code ?: "未归档", 510f, 424f, 28, 25f, 0xff16233f.toInt(), 40f)
        text(canvas, "人员编号", 350f, 470f, 22f, 0xff69758b.toInt(), false, Paint.Align.LEFT)
        textBlock(canvas, summary?.number ?: "待分配", 510f, 470f, 28, 25f, 0xff16233f.toInt(), 40f)

        rows.forEachIndexed { index, (label, value) ->
            val y = contentStart + index * rowHeight
            val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffdbe0ea.toInt(); strokeWidth = 2f }
            canvas.drawLine(92f, (y + 82).toFloat(), 1148f, (y + 82).toFloat(), line)
            textBlock(canvas, label, 112f, (y + 34).toFloat(), labelMaxCharacters, 23f, 0xff69758b.toInt(), 27f,
                bold = true, maxLines = rowMaxLines)
            textBlock(canvas, value, 350f, (y + 34).toFloat(), valueMaxCharacters, 25f, 0xff16233f.toInt(), 31f,
                maxLines = rowMaxLines)
        }

        val footerLine = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xffcdd5e4.toInt(); strokeWidth = 2f }
        canvas.drawLine(92f, footerY.toFloat(), 1148f, footerY.toFloat(), footerLine)
        decodeImage(record.signatureData)?.let { signature ->
            drawImageFit(canvas, signature, 96f, signatureY.toFloat(), 240f, 100f)
            signature.recycle()
        }
        decodeImage(record.officialSealData)?.let { seal ->
            drawImageFit(canvas, seal, 920f, sealY.toFloat(), 150f, 150f)
            seal.recycle()
        }
        val exportedAt = SimpleDateFormat(ARCHIVE_TIME_PATTERN, Locale.CHINA).format(Date())
        text(canvas, "系统生成图片副本 · 导出时间 $exportedAt", 92f, footerTextY.toFloat(), 18f, 0xff8490a6.toInt(), false, Paint.Align.LEFT)

        return writePng(context, bitmap, "${record.userName}-${record.formName}-档案.png")
    }

    // ---------------------------------------------------------------- 落盘

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

    // ---------------------------------------------------------------- 绘图工具

    /**
     * 按 Web 端 `preserveAspectRatio="xMidYMid slice"` 的语义绘制：等比放大铺满目标框、居中裁切，
     * 并按 [radius] 做圆角裁切。直接 `drawBitmap(src, null, dst, paint)` 是**拉伸**，
     * 这正是之前证件照比例不对的原因。
     */
    private fun drawImageSliced(canvas: Canvas, bitmap: Bitmap, left: Float, top: Float, width: Float, height: Float, radius: Float) {
        val scale = maxOf(width / bitmap.width, height / bitmap.height)
        canvas.withSave {
        if (radius > 0f) {
            val path = Path().apply { addRoundRect(RectF(left, top, left + width, top + height), radius, radius, Path.Direction.CW) }
            canvas.clipPath(path)
        }
        drawImageScaled(canvas, bitmap, left, top, width, height, scale)
        }
    }

    /** 等比缩放到目标框内并居中（Web 端 `xMidYMid meet`，用于签名与公章）。 */
    private fun drawImageFit(canvas: Canvas, bitmap: Bitmap, left: Float, top: Float, width: Float, height: Float) {
        drawImageScaled(canvas, bitmap, left, top, width, height, minOf(width / bitmap.width, height / bitmap.height))
    }

    private fun drawImageScaled(canvas: Canvas, bitmap: Bitmap, left: Float, top: Float, width: Float, height: Float, scale: Float) {
        val drawWidth = bitmap.width * scale
        val drawHeight = bitmap.height * scale
        val dx = left + (width - drawWidth) / 2f
        val dy = top + (height - drawHeight) / 2f
        canvas.drawBitmap(bitmap, null, RectF(dx, dy, dx + drawWidth, dy + drawHeight), Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    }

    /** Web 端 avatarPlaceholder：浅蓝底 + 头像剪影 + 「默认头像」。 */
    private fun avatarPlaceholder(canvas: Canvas, x: Float, y: Float, width: Float, height: Float) {
        val centerX = x + width / 2f
        val scale = minOf(width, height)
        fillRect(canvas, x, y, x + width, y + height, 0xffe8efff.toInt())
        canvas.drawCircle(centerX, y + height * 0.36f, scale * 0.17f,
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff88a2e8.toInt() })

        val baseY = y + height * 0.91f
        val shoulderY = baseY - height * 0.34f
        var currentX = x + width * 0.19f
        val path = Path().apply {
            moveTo(currentX, baseY)
            cubicTo(currentX, baseY - height * 0.22f, currentX + width * 0.14f, shoulderY, currentX + width * 0.31f, shoulderY)
            currentX += width * 0.31f
            lineTo(currentX + width * 0.2f, shoulderY)
            currentX += width * 0.2f
            cubicTo(currentX + width * 0.17f, shoulderY, currentX + width * 0.31f, shoulderY + height * 0.12f, currentX + width * 0.31f, baseY)
            currentX += width * 0.31f
            lineTo(currentX, baseY + height * 0.07f)
            close()
        }
        canvas.drawPath(path, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xff627fc8.toInt() })
        text(canvas, "默认头像", centerX, y + height * 0.76f, maxOf(16f, scale * 0.09f), 0xff4664ad.toInt(), true, Paint.Align.CENTER)
    }

    private fun fillRect(canvas: Canvas, left: Float, top: Float, right: Float, bottom: Float, color: Int) {
        canvas.drawRect(left, top, right, bottom, Paint().apply { this.color = color; style = Paint.Style.FILL })
    }

    private fun strokeRect(canvas: Canvas, left: Float, top: Float, right: Float, bottom: Float, color: Int, width: Float) {
        canvas.drawRect(left, top, right, bottom, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color; style = Paint.Style.STROKE; strokeWidth = width
        })
    }

    private fun fillRoundRect(canvas: Canvas, left: Float, top: Float, right: Float, bottom: Float, radius: Float, color: Int) {
        canvas.drawRoundRect(RectF(left, top, right, bottom), radius, radius, Paint().apply { this.color = color; style = Paint.Style.FILL })
    }

    private fun strokeRoundRect(canvas: Canvas, left: Float, top: Float, right: Float, bottom: Float, radius: Float, color: Int, width: Float) {
        canvas.drawRoundRect(RectF(left, top, right, bottom), radius, radius, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color; style = Paint.Style.STROKE; strokeWidth = width
        })
    }

    /** 单行文字；[letterSpacingPx] 与 Web 端的 `letter-spacing` 一样是像素值。 */
    private fun text(
        canvas: Canvas,
        value: String,
        x: Float,
        y: Float,
        size: Float,
        color: Int,
        bold: Boolean,
        align: Paint.Align,
        letterSpacingPx: Float = 0f,
    ) {
        canvas.drawText(value, x, y, paint(color, size, bold, align, letterSpacingPx))
    }

    /** 多行文字，按 Web 端 `textBlock` 的 `lines()` 规则换行。 */
    private fun textBlock(
        canvas: Canvas,
        value: String,
        x: Float,
        y: Float,
        maxCharacters: Int,
        size: Float,
        color: Int,
        lineHeight: Float,
        bold: Boolean = false,
        maxLines: Int = 4,
    ) {
        val paint = paint(color, size, bold, Paint.Align.LEFT)
        lines(value, maxCharacters, maxLines).forEachIndexed { index, line ->
            canvas.drawText(line, x, y + index * lineHeight, paint)
        }
    }

    private fun paint(color: Int, size: Float, bold: Boolean, align: Paint.Align, letterSpacingPx: Float = 0f) =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            textSize = size
            textAlign = align
            typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            if (letterSpacingPx > 0f) letterSpacing = letterSpacingPx / size
        }

    /**
     * 与 Web 端 `lines()` 一致：压缩空白、按 [maxCharacters] 切行、最多 [maxLines] 行；
     * 放不下的截断并在末行补省略号，空值兜底成「未填写」。
     */
    private fun lines(value: String, maxCharacters: Int, maxLines: Int = 4): List<String> {
        val normalized = value.replace(Regex("\\s+"), " ").trim().ifEmpty { "未填写" }
        val result = mutableListOf<String>()
        var index = 0
        while (index < normalized.length) {
            result += normalized.substring(index, minOf(index + maxCharacters, normalized.length))
            index += maxCharacters
        }
        if (result.size <= maxLines) return result
        val clipped = result.take(maxLines).toMutableList()
        clipped[maxLines - 1] = clipped[maxLines - 1].take(maxOf(1, maxCharacters - 1)) + "…"
        return clipped
    }

    /** 与 Web 端 `displayValue` 一致：图片字段显示「已上传图片」，避免把 base64 打进图里。 */
    private fun displayValue(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "未填写"
        is String -> when {
            value.startsWith("data:image/") -> "已上传图片"
            value.isBlank() -> "未填写"
            else -> value
        }
        else -> value.toString()
    }

    private fun decodeImage(data: String?): Bitmap? {
        return com.custodysim.app.data.media.decodeDataUrlBitmap(data, MAX_SOURCE_PX)
    }
}
