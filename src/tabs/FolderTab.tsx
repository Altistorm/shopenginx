import { useState } from 'react'

interface FolderEntry {
  path: string
  name: string
  type: 'file' | 'folder'
  size: number
  depth: number
}

function FolderTab() {
  const [entries, setEntries] = useState<FolderEntry[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const stats = {
    folders: entries.filter(e => e.type === 'folder').length,
    files: entries.filter(e => e.type === 'file').length,
    totalSize: entries.reduce((sum, e) => sum + (e.size || 0), 0)
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const selectFolder = async () => {
    setIsLoading(true)
    // Simulate folder selection - in real implementation, use chrome.runtime.sendMessage
    setTimeout(() => {
      setEntries([
        { path: 'src', name: 'src', type: 'folder', size: 0, depth: 0 },
        { path: 'src/App.tsx', name: 'App.tsx', type: 'file', size: 2048, depth: 1 },
        { path: 'src/index.css', name: 'index.css', type: 'file', size: 512, depth: 1 },
        { path: 'public', name: 'public', type: 'folder', size: 0, depth: 0 },
        { path: 'public/icon.png', name: 'icon.png', type: 'file', size: 4096, depth: 1 },
      ])
      setIsLoading(false)
    }, 500)
  }

  const exportJson = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      summary: stats,
      entries
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `folder-structure-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredEntries = entries.filter(e =>
    e.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex gap-2">
        <button className="btn btn-primary flex-1" onClick={selectFolder}>
          📂 เลือกโฟลเดอร์
        </button>
        {entries.length > 0 && (
          <button className="btn btn-success" onClick={exportJson}>
            📥 Export JSON
          </button>
        )}
      </div>

      {/* Search */}
      {entries.length > 0 && (
        <input
          type="text"
          placeholder="🔍 ค้นหาไฟล์..."
          className="input input-bordered w-full"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      )}

      {/* Stats */}
      {entries.length > 0 && (
        <div className="stats stats-vertical lg:stats-horizontal shadow bg-base-300 w-full">
          <div className="stat py-2">
            <div className="stat-title text-xs">โฟลเดอร์</div>
            <div className="stat-value text-primary text-lg">{stats.folders}</div>
          </div>
          <div className="stat py-2">
            <div className="stat-title text-xs">ไฟล์</div>
            <div className="stat-value text-secondary text-lg">{stats.files}</div>
          </div>
          <div className="stat py-2">
            <div className="stat-title text-xs">ขนาดรวม</div>
            <div className="stat-value text-accent text-lg">{formatSize(stats.totalSize)}</div>
          </div>
        </div>
      )}

      {/* Tree View */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <span className="loading loading-spinner loading-lg text-primary"></span>
        </div>
      ) : entries.length > 0 ? (
        <div className="bg-base-300 rounded-xl p-3 max-h-64 overflow-auto">
          <div className="font-mono text-sm space-y-1">
            {filteredEntries.map((entry, index) => (
              <div
                key={index}
                className="flex items-center gap-2 hover:bg-base-200 px-2 py-1 rounded"
                style={{ paddingLeft: `${entry.depth * 16 + 8}px` }}
              >
                <span>{entry.type === 'folder' ? '📁' : '📄'}</span>
                <span className={entry.type === 'folder' ? 'text-primary font-medium' : ''}>
                  {entry.name}
                </span>
                {entry.type === 'file' && (
                  <span className="text-xs opacity-50 ml-auto">{formatSize(entry.size)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-base-content/50">
          <span className="text-4xl">📂</span>
          <p className="mt-2">คลิก "เลือกโฟลเดอร์" เพื่อดูโครงสร้างไฟล์</p>
        </div>
      )}
    </div>
  )
}

export default FolderTab
