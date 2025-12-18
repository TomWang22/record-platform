'use client'

import { useState, useRef } from 'react'
import type { ChangeEvent } from 'react'
import { Button } from '@/components/ui/button'
import { X, Upload, Image, Video, File, Music } from 'lucide-react'

export type AttachmentFile = {
  id: string
  file: File
  preview?: string
  file_type: 'image' | 'video' | 'audio' | 'document' | 'other'
  file_url?: string
  thumbnail_url?: string
  file_name?: string
  file_size?: number
  mime_type?: string
  width?: number
  height?: number
  duration?: number
}

type AttachmentUploadProps = {
  onAttachmentsChange: (attachments: AttachmentFile[]) => void
  maxAttachments?: number
  allowedTypes?: string[]
  maxSizeMB?: number
}

export function AttachmentUpload({
  onAttachmentsChange,
  maxAttachments = 10,
  allowedTypes = ['image/*', 'video/*', 'audio/*', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  maxSizeMB = 50,
}: AttachmentUploadProps) {
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const getFileType = (file: File): AttachmentFile['file_type'] => {
    if (file.type.startsWith('image/')) return 'image'
    if (file.type.startsWith('video/')) return 'video'
    if (file.type.startsWith('audio/')) return 'audio'
    if (file.type.includes('pdf') || file.type.includes('document') || file.type.includes('text')) return 'document'
    return 'other'
  }

  const getFileIcon = (fileType: AttachmentFile['file_type']) => {
    switch (fileType) {
      case 'image':
        return <Image className="h-4 w-4" />
      case 'video':
        return <Video className="h-4 w-4" />
      case 'audio':
        return <Music className="h-4 w-4" />
      default:
        return <File className="h-4 w-4" />
    }
  }

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    
    if (attachments.length + files.length > maxAttachments) {
      alert(`Maximum ${maxAttachments} attachments allowed`)
      return
    }

    const newAttachments: AttachmentFile[] = []

    for (const file of files) {
      // Check file size
      if (file.size > maxSizeMB * 1024 * 1024) {
        alert(`File ${file.name} exceeds ${maxSizeMB}MB limit`)
        continue
      }

      const fileType = getFileType(file)
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      
      let preview: string | undefined
      if (fileType === 'image') {
        preview = URL.createObjectURL(file)
      }

      newAttachments.push({
        id,
        file,
        preview,
        file_type: fileType,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
      })
    }

    const updatedAttachments = [...attachments, ...newAttachments]
    setAttachments(updatedAttachments)
    onAttachmentsChange(updatedAttachments)

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const removeAttachment = (id: string) => {
    const updated = attachments.filter(a => a.id !== id)
    setAttachments(updated)
    onAttachmentsChange(updated)
  }

  const uploadAttachment = async (attachment: AttachmentFile, endpoint: string): Promise<AttachmentFile> => {
    // In a real implementation, you would upload the file to a storage service
    // and get back file_url, thumbnail_url, etc.
    // For now, we'll simulate this with a placeholder
    
    // TODO: Implement actual file upload to storage (S3, Cloudinary, etc.)
    // const formData = new FormData()
    // formData.append('file', attachment.file)
    // const uploadResponse = await fetch('/api/upload', { method: 'POST', body: formData })
    // const uploadData = await uploadResponse.json()
    
    // For now, return the attachment with a placeholder URL
    return {
      ...attachment,
      file_url: URL.createObjectURL(attachment.file),
      thumbnail_url: attachment.preview,
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={allowedTypes.join(',')}
          onChange={handleFileSelect}
          className="hidden"
          id="attachment-upload"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={attachments.length >= maxAttachments}
        >
          <Upload className="h-4 w-4 mr-2" />
          Add Attachments ({attachments.length}/{maxAttachments})
        </Button>
      </div>

      {attachments.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="relative rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden bg-slate-50 dark:bg-slate-800"
            >
              {attachment.preview ? (
                <img
                  src={attachment.preview}
                  alt={attachment.file_name}
                  className="w-full h-24 object-cover"
                />
              ) : (
                <div className="w-full h-24 flex items-center justify-center">
                  {getFileIcon(attachment.file_type)}
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                className="absolute top-1 right-1 p-1 rounded-full bg-rose-500 text-white hover:bg-rose-600"
              >
                <X className="h-3 w-3" />
              </button>
              <div className="p-2">
                <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                  {attachment.file_name}
                </p>
                <p className="text-xs text-slate-400">
                  {(attachment.file_size! / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

