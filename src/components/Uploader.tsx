import { useReducer, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { supported, fileOpen, FileWithHandle } from 'browser-fs-access'
import styles from './Uploader.module.less'
import { useDispatch, getList, globalStore } from '../state'
import { confirm } from './Modal'
import { useI18n, saveVideoSubPairs, getFileList, IS_MOBILE, trackImportFiles } from '../utils'
import { DownloadExample } from './List'
import cn from 'classnames'

export const Uploader = () => {
  const dispatch = useDispatch()
  const i18n = useI18n()

  const subtitleHandles = useRef<FileWithHandle[]>([])
  const videoHandles = useRef<FileWithHandle[]>([])
  const [, _forceUpdate] = useReducer(s => !s, true)
  const forceUpdate = () => flushSync(_forceUpdate)
  const [processing, setProcessing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [saveCache, setSaveCache] = useState(false)
  const [transition, setTransition] = useState({ vUp: -1, vDown: -1, sUp: -1, sDown: -1 })

  const onSave = async () => {
    const vs = videoHandles.current
    const ss = subtitleHandles.current
    const exist = await checkExist(vs)
    if (exist.length > 0) {
      const overwrite = await confirm(i18n('confirm.overwrite_existing_file', exist.join(', ')))
      if (!overwrite) {
        return
      }
    }
    trackImportFiles(vs.length, ss.length)
    await saveVideoSubPairs(vs, ss, saveCache)
    videoHandles.current = []
    subtitleHandles.current = []
    setSaveCache(false)
    setProcessing(true)
    dispatch(getList())

    // wait until file list is updated
    await new Promise<void>(resolve => {
      const unsubscribe = globalStore.subscribe(() => {
        unsubscribe()
        resolve()
      })
    })
    setProcessing(false)
  }

  const addToBuf = (vhs: FileWithHandle[], shs: FileWithHandle[]) => {
    videoHandles.current = videoHandles.current
      .concat(vhs)
      .filter((v, i, a) => a.findIndex(t => t.name === v.name) === i)
    subtitleHandles.current = subtitleHandles.current
      .concat(shs)
      .filter((v, i, a) => a.findIndex(t => t.name === v.name) === i)
    forceUpdate()
  }

  const move = (type: 'video' | 'subtitle', direction: 'up' | 'down', prev: number) => (e: React.MouseEvent) => {
    if (locked) return
    locked = true
    e.stopPropagation()
    const handles = type === 'video' ? videoHandles.current : subtitleHandles.current
    const next = prev + (direction === 'up' ? -1 : 1)
    if (next < 0 || next > handles.length - 1) {
      locked = false
      return
    }
    if (transition.sUp !== -1 || transition.sDown !== -1 || transition.vUp !== -1 || transition.vDown !== -1) {
      locked = false
      return
    }
    if (direction === 'up') {
      if (type === 'video') {
        setTransition(s => ({ ...s, vUp: prev, vDown: prev - 1 }))
      } else {
        setTransition(s => ({ ...s, sUp: prev, sDown: prev - 1 }))
      }
    } else {
      if (type === 'video') {
        setTransition(s => ({ ...s, vUp: prev + 1, vDown: prev }))
      } else {
        setTransition(s => ({ ...s, sUp: prev + 1, sDown: prev }))
      }
    }
    const liEl = e.currentTarget.parentElement as HTMLLIElement
    const onEnd = () => {
      const tmp = handles[prev]
      handles[prev] = handles[next]
      handles[next] = tmp
      setTransition({ vUp: -1, vDown: -1, sUp: -1, sDown: -1 })
      liEl.removeEventListener('transitionend', onEnd)
      locked = false
    }
    liEl.addEventListener('transitionend', onEnd)
  }

  const hasBuffer = videoHandles.current.length > 0 || subtitleHandles.current.length > 0
  const uploadStyle = { display: hasBuffer ? undefined : 'none' }

  const uploadElm = (
    <div className={styles['container']}>
      <div
        className={cn(styles['upload-area'], { 'drag-over': dragOver })}
        onDragOver={event => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => {
          setDragOver(false)
        }}
        onDrop={async event => {
          setDragOver(false)
          event.preventDefault()
          const items = Array.from(event.dataTransfer.items).filter(i => i.kind === 'file')
          const files: FileWithHandle[] = await Promise.all(
            items.map(async i => {
              const f: FileWithHandle = i.getAsFile() as File
              if (supported) {
                f.handle = (await i.getAsFileSystemHandle()) as FileSystemFileHandle
              }
              return f
            }),
          )
          const { videos, subtitles } = await filterFileHandles(files)
          addToBuf(videos, subtitles)
        }}
      >
        <div className="material-icons-outlined">folder_open</div>
        <div className={styles['upload-main']}>{i18n('import_video_and_subtitle.drag')}</div>
        <div className={styles['separate']}>
          <div className={styles['separate-line']} />
          <div className={styles['separate-or']}>{i18n('import_video_and_subtitle.or')}</div>
          <div className={styles['separate-line']} />
        </div>
        <button
          className={styles['browse-files']}
          onClick={async () => {
            const { videos, subtitles } = await pickFiles()
            addToBuf(videos, subtitles)
          }}
        >
          {i18n('import_video_and_subtitle.browse')}
        </button>
      </div>
      <div className={styles['buffer-container']}>
        <div className={styles['buffer']} style={uploadStyle}>
          <div className={styles['videos']}>
            <div className="material-icons">live_tv</div>
            <ul
              onMouseDown={dndMouseDown(reorder(videoHandles.current, forceUpdate))}
              onTouchStart={dndTouchStart(reorder(videoHandles.current, forceUpdate))}
              className={cn({ [styles['has-transition']]: transition.vUp !== -1 })}
            >
              {videoHandles.current
                .map(v => v.name)
                .map((v, index) => (
                  <li
                    key={v}
                    className={cn({
                      [styles['upward']]: transition.vUp === index,
                      [styles['downward']]: transition.vDown === index,
                    })}
                    title={v}
                  >
                    <span className={styles['file']}>{v}</span>
                    <span className="material-icons" onMouseDown={move('video', 'up', index)}>
                      arrow_upward
                    </span>
                    <span className="material-icons" onMouseDown={move('video', 'down', index)}>
                      arrow_downward
                    </span>
                    <span
                      className="material-icons"
                      onClick={() => {
                        videoHandles.current = videoHandles.current.filter(i => i.name !== v)
                        forceUpdate()
                      }}
                    >
                      close
                    </span>
                  </li>
                ))}
            </ul>
          </div>
          <div className={styles['subtitles']}>
            <div className="material-icons">closed_caption_off</div>
            <ul
              onMouseDown={dndMouseDown(reorder(subtitleHandles.current, forceUpdate))}
              onTouchStart={dndTouchStart(reorder(subtitleHandles.current, forceUpdate))}
              className={cn({ [styles['has-transition']]: transition.sUp !== -1 })}
            >
              {subtitleHandles.current
                .map(s => s.name)
                .map((s, index) => (
                  <li
                    key={s}
                    className={cn({
                      [styles['upward']]: transition.sUp === index,
                      [styles['downward']]: transition.sDown === index,
                    })}
                    title={s}
                  >
                    <span className={styles['file']}>{s}</span>
                    <span className="material-icons" onMouseDown={move('subtitle', 'up', index)}>
                      arrow_upward
                    </span>
                    <span className="material-icons" onMouseDown={move('subtitle', 'down', index)}>
                      arrow_downward
                    </span>
                    <span
                      className="material-icons"
                      onClick={() => {
                        subtitleHandles.current = subtitleHandles.current.filter(i => i.name !== s)
                        forceUpdate()
                      }}
                    >
                      close
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </div>
      <div className={styles['save-cache']} style={uploadStyle}>
        <input
          id="upload-save-cache"
          type="checkbox"
          checked={saveCache}
          onChange={e => {
            setSaveCache(e.target.checked)
          }}
        />
        <label htmlFor="upload-save-cache">{i18n('import_video_and_subtitle.save_cache')}</label>
      </div>
      <div className={styles['ok']} style={uploadStyle}>
        <button onClick={onSave}>{i18n('import_video_and_subtitle.save')}</button>
      </div>
    </div>
  )

  return (
    <>
      {uploadElm}
      <DownloadExample show={!hasBuffer && !processing} />
    </>
  )
}

async function pickFiles() {
  try {
    const files = await fileOpen({
      description: 'Videos & Subtitles',
      multiple: true,
      id: 'video-and-subtitle',
    })
    return filterFileHandles(files)
  } catch {
    return { videos: [], subtitles: [] }
  }
}

async function filterFileHandles(files: FileWithHandle[]) {
  const isSubtitle = (s: string) => /\.(srt|ssa|ass)$/i.test(s)
  const videos = files.filter(h => !isSubtitle(h.name))
  const subtitles = files.filter(h => isSubtitle(h.name))
  return { videos, subtitles }
}

async function checkExist(vs: FileWithHandle[]): Promise<string[]> {
  const fs = vs.map(i => i.name)
  const fileNames = new Set(await getFileList())
  return fs.filter(i => fileNames.has(i))
}

const dndMouseDown =
  (cb: (selected: number, hovered: number) => void): React.MouseEventHandler =>
  e => {
    const getEvent = () => {
      return {
        clientX: e.clientX,
        clientY: e.clientY,
        currentTarget: e.currentTarget,
      }
    }
    if (IS_MOBILE) return
    dndStart(cb, getEvent)
  }

const dndTouchStart =
  (cb: (selected: number, hovered: number) => void): React.TouchEventHandler =>
  e => {
    const getEvent = () => {
      return {
        clientX: e.touches[0].clientX,
        clientY: e.touches[0].clientY,
        currentTarget: e.currentTarget,
      }
    }
    if (!IS_MOBILE) return
    dndStart(cb, getEvent)
  }

let locked = false

const dndStart = (
  cb: (selected: number, hovered: number) => void,
  getEvent: () => { clientX: number; clientY: number; currentTarget: EventTarget },
) => {
  if (locked) return
  locked = true

  const e = getEvent()
  const h = 26
  const m = 5
  const ul = e.currentTarget as HTMLUListElement
  const { left, top, width: ulWidth, height: ulHeight } = ul.getBoundingClientRect()
  const getXY = (e: { clientX: number; clientY: number }) => ({ x: e.clientX - left, y: e.clientY - top })

  const { y: startY } = getXY(e)
  const selected = Math.floor(startY / (h + m))
  // margin area, ignore
  if (startY > selected * (h + m) + h) {
    locked = false
    return
  }
  const selectedLi = ul.children[selected] as HTMLLIElement

  ul.classList.add(styles['has-transition'])
  selectedLi.classList.add(styles['selected'])
  const removeTransitions = () => {
    Array.from(ul.children).forEach(li => {
      li.classList.remove(styles['upward'])
      li.classList.remove(styles['downward'])
    })
  }

  let prevHovered = -1
  const cleanUp = async () => {
    if (!IS_MOBILE) {
      ul.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', cleanUp)
    } else {
      ul.removeEventListener('touchmove', onMove)
      ul.removeEventListener('touchend', cleanUp)
    }

    selectedLi.classList.remove(styles['selected'])
    await new Promise<void>(res => {
      if (prevHovered === -1) {
        res()
        return
      }
      const targetTop = (prevHovered - selected) * (h + m)
      selectedLi.style.top = `${targetTop}px`
      const onEnd = () => {
        res()
        selectedLi.removeEventListener('transitionend', onEnd)
      }
      selectedLi.addEventListener('transitionend', onEnd)
      // sometimes transitionend is not fired?
      setTimeout(onEnd, 200)
    })
    ul.classList.remove(styles['has-transition'])
    removeTransitions()
    selectedLi.style.removeProperty('top')
    if (prevHovered !== -1) {
      cb(selected, prevHovered)
    }

    locked = false
  }
  const onMove = (e: MouseEvent | TouchEvent) => {
    const { x, y } = getXY(e instanceof MouseEvent ? e : e.touches[0])
    const within = x >= 0 && x <= ulWidth && y >= 0 && y <= ulHeight
    let hovered = Math.floor(y / (h + m))
    if (y > hovered * (h + m) + h || !within) hovered = -1
    if (hovered !== -1 && prevHovered !== hovered) {
      prevHovered = hovered

      removeTransitions()
      if (hovered > selected) {
        for (let i = selected + 1; i <= hovered; i++) {
          ul.children[i].classList.add(styles['upward'])
        }
      } else {
        for (let i = hovered; i < selected; i++) {
          ul.children[i].classList.add(styles['downward'])
        }
      }
    }
    if (within) {
      selectedLi.style.top = `${y - startY}px`
    }
  }
  if (!IS_MOBILE) {
    ul.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', cleanUp)
  } else {
    ul.addEventListener('touchmove', onMove)
    ul.addEventListener('touchend', cleanUp)
  }
}

const reorder =
  <T,>(array: T[], forceUpdate: () => void) =>
  (selected: number, hovered: number) => {
    const tmp = array[selected]
    if (selected < hovered) {
      for (let i = selected + 1; i <= hovered; i++) {
        array[i - 1] = array[i]
      }
    } else {
      for (let i = selected - 1; i >= hovered; i--) {
        array[i + 1] = array[i]
      }
    }
    array[hovered] = tmp
    forceUpdate()
  }
