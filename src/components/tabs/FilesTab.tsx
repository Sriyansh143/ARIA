'use client';

import { useState, useEffect } from 'react';
import { Folder, File as FileIcon, RefreshCw, Save, Loader2, ChevronRight } from 'lucide-react';
import { JARVIS } from '@/lib/config';
import { SectionTitle, EmptyState } from '@/components/jarvis/shared';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface FileEntry { name: string; type: 'file' | 'directory'; size: number; }

export default function FilesTab() {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const listFiles = async (dirPath: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/file/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      });
      const data = await res.json();
      if (data.entries) {
        setEntries(data.entries);
        setPath(data.path || dirPath);
      }
    } catch {
      toast({ title: 'Failed to list files', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const openFile = async (name: string) => {
    const fullPath = path ? `${path}/${name}` : name;
    setFileLoading(true);
    setSelectedFile(fullPath);
    try {
      const res = await fetch('/api/file/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fullPath }),
      });
      const data = await res.json();
      if (data.content) {
        setFileContent(data.content);
      } else {
        toast({ title: data.error || 'Failed to read file', variant: 'destructive' });
        setSelectedFile(null);
      }
    } catch {
      toast({ title: 'Failed to read file', variant: 'destructive' });
      setSelectedFile(null);
    } finally {
      setFileLoading(false);
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      const res = await fetch('/api/file/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: fileContent }),
      });
      const data = await res.json();
      if (data.ok) {
        toast({ title: 'File saved', description: selectedFile });
      } else {
        toast({ title: data.error || 'Save failed', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Save failed', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => { listFiles(''); }, []);

  const navigateTo = (name: string) => {
    const newPath = path ? `${path}/${name}` : name;
    listFiles(newPath);
    setSelectedFile(null);
  };

  const goUp = () => {
    if (!path) return;
    const parts = path.split('/');
    parts.pop();
    listFiles(parts.join('/'));
    setSelectedFile(null);
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      <SectionTitle
        title="File Explorer"
        icon={Folder}
        accent={JARVIS.colors.amber}
        action={
          <Button size="sm" variant="outline" onClick={() => listFiles(path)} className="border-[var(--j-border)] bg-transparent hover:bg-[var(--j-panel-soft)]">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        }
      />
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* File list */}
        <div className="jarvis-panel p-4 overflow-y-auto jarvis-scroll">
          <div className="flex items-center gap-2 mb-3">
            <button onClick={goUp} disabled={!path} className="jarvis-mono text-[10px] uppercase text-[var(--j-text-mute)] hover:text-[var(--j-cyan)] disabled:opacity-30">
              ← Up
            </button>
            <span className="jarvis-mono text-xs text-[var(--j-cyan)] truncate">/{path || 'workspace'}</span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--j-cyan)]" />
            </div>
          ) : entries.length > 0 ? (
            <div className="space-y-1">
              {entries.map((entry) => (
                <button
                  key={entry.name}
                  onClick={() => entry.type === 'directory' ? navigateTo(entry.name) : openFile(entry.name)}
                  className={`w-full flex items-center gap-2 p-2 rounded text-left hover:bg-[var(--j-panel-soft)] transition-colors ${
                    selectedFile?.endsWith(entry.name) ? 'bg-[var(--j-cyan)]/10 border border-[var(--j-cyan)]/30' : ''
                  }`}
                >
                  {entry.type === 'directory' ? (
                    <Folder className="h-4 w-4 text-[var(--j-amber)] shrink-0" />
                  ) : (
                    <FileIcon className="h-4 w-4 text-[var(--j-text-mute)] shrink-0" />
                  )}
                  <span className="text-xs flex-1 truncate">{entry.name}</span>
                  {entry.type === 'file' && (
                    <span className="jarvis-mono text-[9px] text-[var(--j-text-mute)]">{entry.size}B</span>
                  )}
                  {entry.type === 'directory' && <ChevronRight className="h-3 w-3 text-[var(--j-text-mute)]" />}
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={Folder} message="Workspace is empty" hint="Use the Command Center to create files with 'write file: path'" />
          )}
        </div>

        {/* File editor */}
        <div className="jarvis-panel p-4 flex flex-col">
          {selectedFile ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="jarvis-mono text-xs text-[var(--j-cyan)] truncate flex-1">{selectedFile}</span>
                <Button size="sm" onClick={saveFile} disabled={saving || fileLoading} className="jarvis-btn-accent border-0 ml-2">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Save
                </Button>
              </div>
              {fileLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--j-cyan)]" />
                </div>
              ) : (
                <Textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="flex-1 bg-[var(--j-panel-soft)] border-[var(--j-border)] font-mono text-xs resize-none min-h-[400px]"
                />
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-center">
              <div>
                <FileIcon className="h-8 w-8 mx-auto mb-2 text-[var(--j-text-mute)] opacity-30" />
                <div className="text-xs text-[var(--j-text-mute)]">Select a file to view or edit</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
