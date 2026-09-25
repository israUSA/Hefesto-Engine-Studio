import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  LucideAlarmClock,
  LucideArrowRight,
  LucideBadgeCheck,
  LucideCalendar,
  LucideCheck,
  LucideChevronDown,
  LucideChevronLeft,
  LucideChevronRight,
  LucideCircle,
  LucideCircleAlert,
  LucideCirclePlay,
  LucideClapperboard,
  LucideClock,
  LucideCloudDownload,
  LucideCloudUpload,
  LucideCopy,
  LucideCpu,
  LucideDatabase,
  LucideEye,
  LucideEyeOff,
  LucideExternalLink,
  LucideFolderOpen,
  LucideGlobe,
  LucideHardDrive,
  LucideHouse,
  LucideImage,
  LucideKeyRound,
  LucideLayoutGrid,
  LucideLightbulb,
  LucideLink2,
  LucideListFilter,
  LucideListOrdered,
  LucideLoaderCircle,
  LucideMemoryStick,
  LucideMessageSquare,
  LucideMic,
  LucideMonitorSmartphone,
  LucideMoon,
  LucideMusic2,
  LucidePause,
  LucidePencil,
  LucidePlay,
  LucidePlus,
  LucideRefreshCw,
  LucideSettings,
  LucideShieldCheck,
  LucideSkipForward,
  LucideSparkles,
  LucideSquare,
  LucideSun,
  LucideTerminal,
  LucideTrash,
  LucideTriangleAlert,
  LucideUpload,
  LucideUsers,
  LucideVideo,
  LucideVolume2,
  LucideWallet,
  LucideWifiOff,
  LucideX,
} from '@lucide/angular';

/** Names accepted by <hf-icon>. Add to this map and the imports above together. */
export type IconName =
  | 'home'
  | 'lightbulb'
  | 'play'
  | 'queue'
  | 'grid'
  | 'calendar'
  | 'drive'
  | 'wallet'
  | 'terminal'
  | 'settings'
  | 'plus'
  | 'tiktok'
  | 'youtube'
  | 'pause'
  | 'skip'
  | 'stop'
  | 'link'
  | 'key'
  | 'refresh'
  | 'zap'
  | 'upload'
  | 'check'
  | 'close'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'arrow-right'
  | 'mic'
  | 'play-circle'
  | 'image'
  | 'edit'
  | 'trash'
  | 'external-link'
  | 'wifi-off'
  | 'alert-triangle'
  | 'alert-circle'
  | 'cpu'
  | 'users'
  | 'globe'
  | 'volume'
  | 'sparkles'
  | 'database'
  | 'monitor'
  | 'sun'
  | 'moon'
  | 'info'
  | 'shield-check'
  | 'clock'
  | 'dot'
  | 'memory'
  | 'folder'
  | 'eye'
  | 'eye-off'
  | 'copy'
  | 'filter'
  | 'message'
  | 'badge-check'
  | 'clapperboard'
  | 'cloud-upload'
  | 'cloud-download'
  | 'loader'
  | 'alarm';

@Component({
  selector: 'hf-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideHouse,
    LucideLightbulb,
    LucidePlay,
    LucideListOrdered,
    LucideLayoutGrid,
    LucideCalendar,
    LucideHardDrive,
    LucideWallet,
    LucideTerminal,
    LucideSettings,
    LucidePlus,
    LucideMusic2,
    LucideVideo,
    LucidePause,
    LucideSkipForward,
    LucideSquare,
    LucideLink2,
    LucideKeyRound,
    LucideRefreshCw,
    LucideUpload,
    LucideCheck,
    LucideX,
    LucideChevronDown,
    LucideChevronRight,
    LucideChevronLeft,
    LucideArrowRight,
    LucideMic,
    LucideCirclePlay,
    LucideImage,
    LucidePencil,
    LucideTrash,
    LucideExternalLink,
    LucideWifiOff,
    LucideTriangleAlert,
    LucideCircleAlert,
    LucideCpu,
    LucideUsers,
    LucideGlobe,
    LucideVolume2,
    LucideSparkles,
    LucideDatabase,
    LucideMonitorSmartphone,
    LucideSun,
    LucideMoon,
    LucideBadgeCheck,
    LucideShieldCheck,
    LucideClock,
    LucideCircle,
    LucideMemoryStick,
    LucideFolderOpen,
    LucideEye,
    LucideEyeOff,
    LucideCopy,
    LucideListFilter,
    LucideMessageSquare,
    LucideClapperboard,
    LucideCloudUpload,
    LucideCloudDownload,
    LucideLoaderCircle,
    LucideAlarmClock,
  ],
  template: `
    @switch (name()) {
      @case ('home') {
        <svg lucideHouse [size]="size()" />
      }
      @case ('lightbulb') {
        <svg lucideLightbulb [size]="size()" />
      }
      @case ('play') {
        <svg lucidePlay [size]="size()" />
      }
      @case ('queue') {
        <svg lucideListOrdered [size]="size()" />
      }
      @case ('grid') {
        <svg lucideLayoutGrid [size]="size()" />
      }
      @case ('calendar') {
        <svg lucideCalendar [size]="size()" />
      }
      @case ('drive') {
        <svg lucideHardDrive [size]="size()" />
      }
      @case ('wallet') {
        <svg lucideWallet [size]="size()" />
      }
      @case ('terminal') {
        <svg lucideTerminal [size]="size()" />
      }
      @case ('settings') {
        <svg lucideSettings [size]="size()" />
      }
      @case ('plus') {
        <svg lucidePlus [size]="size()" />
      }
      @case ('tiktok') {
        <svg lucideMusic2 [size]="size()" />
      }
      @case ('youtube') {
        <svg lucideVideo [size]="size()" />
      }
      @case ('pause') {
        <svg lucidePause [size]="size()" />
      }
      @case ('skip') {
        <svg lucideSkipForward [size]="size()" />
      }
      @case ('stop') {
        <svg lucideSquare [size]="size()" />
      }
      @case ('link') {
        <svg lucideLink2 [size]="size()" />
      }
      @case ('key') {
        <svg lucideKeyRound [size]="size()" />
      }
      @case ('refresh') {
        <svg lucideRefreshCw [size]="size()" />
      }
      @case ('zap') {
        <svg lucideRefreshCw [size]="size()" />
      }
      @case ('upload') {
        <svg lucideUpload [size]="size()" />
      }
      @case ('check') {
        <svg lucideCheck [size]="size()" />
      }
      @case ('close') {
        <svg lucideX [size]="size()" />
      }
      @case ('chevron-down') {
        <svg lucideChevronDown [size]="size()" />
      }
      @case ('chevron-right') {
        <svg lucideChevronRight [size]="size()" />
      }
      @case ('chevron-left') {
        <svg lucideChevronLeft [size]="size()" />
      }
      @case ('arrow-right') {
        <svg lucideArrowRight [size]="size()" />
      }
      @case ('mic') {
        <svg lucideMic [size]="size()" />
      }
      @case ('play-circle') {
        <svg lucideCirclePlay [size]="size()" />
      }
      @case ('image') {
        <svg lucideImage [size]="size()" />
      }
      @case ('edit') {
        <svg lucidePencil [size]="size()" />
      }
      @case ('trash') {
        <svg lucideTrash [size]="size()" />
      }
      @case ('external-link') {
        <svg lucideExternalLink [size]="size()" />
      }
      @case ('wifi-off') {
        <svg lucideWifiOff [size]="size()" />
      }
      @case ('alert-triangle') {
        <svg lucideTriangleAlert [size]="size()" />
      }
      @case ('alert-circle') {
        <svg lucideCircleAlert [size]="size()" />
      }
      @case ('cpu') {
        <svg lucideCpu [size]="size()" />
      }
      @case ('users') {
        <svg lucideUsers [size]="size()" />
      }
      @case ('globe') {
        <svg lucideGlobe [size]="size()" />
      }
      @case ('volume') {
        <svg lucideVolume2 [size]="size()" />
      }
      @case ('sparkles') {
        <svg lucideSparkles [size]="size()" />
      }
      @case ('database') {
        <svg lucideDatabase [size]="size()" />
      }
      @case ('monitor') {
        <svg lucideMonitorSmartphone [size]="size()" />
      }
      @case ('sun') {
        <svg lucideSun [size]="size()" />
      }
      @case ('moon') {
        <svg lucideMoon [size]="size()" />
      }
      @case ('badge-check') {
        <svg lucideBadgeCheck [size]="size()" />
      }
      @case ('shield-check') {
        <svg lucideShieldCheck [size]="size()" />
      }
      @case ('clock') {
        <svg lucideClock [size]="size()" />
      }
      @case ('dot') {
        <svg lucideCircle [size]="size()" />
      }
      @case ('memory') {
        <svg lucideMemoryStick [size]="size()" />
      }
      @case ('folder') {
        <svg lucideFolderOpen [size]="size()" />
      }
      @case ('eye') {
        <svg lucideEye [size]="size()" />
      }
      @case ('eye-off') {
        <svg lucideEyeOff [size]="size()" />
      }
      @case ('copy') {
        <svg lucideCopy [size]="size()" />
      }
      @case ('filter') {
        <svg lucideListFilter [size]="size()" />
      }
      @case ('message') {
        <svg lucideMessageSquare [size]="size()" />
      }
      @case ('clapperboard') {
        <svg lucideClapperboard [size]="size()" />
      }
      @case ('cloud-upload') {
        <svg lucideCloudUpload [size]="size()" />
      }
      @case ('cloud-download') {
        <svg lucideCloudDownload [size]="size()" />
      }
      @case ('loader') {
        <svg lucideLoaderCircle [size]="size()" class="hf-icon-spin" />
      }
      @case ('alarm') {
        <svg lucideAlarmClock [size]="size()" />
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 0;
    }
    .hf-icon-spin {
      animation: hf-spin 0.8s linear infinite;
    }
    @keyframes hf-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input<number>(16);
}
