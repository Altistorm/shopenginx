import { useState } from 'react'
import VideoTab from './tabs/VideoTab'
import ImageTab from './tabs/ImageTab'
import AutoTab from './tabs/AutoTab'
import FolderTab from './tabs/FolderTab'

type TabType = 'video' | 'image' | 'auto' | 'folder'

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('video')

  const tabs = [
    { id: 'video' as TabType, label: 'Video', icon: '🎬' },
    { id: 'image' as TabType, label: 'Image', icon: '🖼️' },
    { id: 'auto' as TabType, label: 'Auto', icon: '🚀' },
    { id: 'folder' as TabType, label: 'Folder', icon: '📁' },
  ]

  return (
    <div className="min-h-screen bg-base-300 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          ShopEnginX
        </h1>
        <button className="btn btn-ghost btn-sm">⚙️</button>
      </div>

      {/* Tabs */}
      <div role="tablist" className="tabs tabs-boxed bg-base-200 mb-4">
        {tabs.map((tab) => (
          <a
            key={tab.id}
            role="tab"
            className={`tab ${activeTab === tab.id ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon} {tab.label}
          </a>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-base-200 rounded-xl p-4">
        {activeTab === 'video' && <VideoTab />}
        {activeTab === 'image' && <ImageTab />}
        {activeTab === 'auto' && <AutoTab />}
        {activeTab === 'folder' && <FolderTab />}
      </div>
    </div>
  )
}

export default App
