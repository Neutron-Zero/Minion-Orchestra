import { Component, AfterViewInit, ViewChild, ElementRef, QueryList, ViewChildren } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AgentMonitorService } from './services/agent-monitor.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements AfterViewInit {
  title = 'minion-orchestra';
  connectionStatus$: Observable<boolean>;
  
  @ViewChild('navUnderline') navUnderline!: ElementRef<HTMLDivElement>;
  @ViewChild('navLinks') navLinks!: ElementRef<HTMLDivElement>;
  @ViewChildren('navLink') navLinkElements!: QueryList<ElementRef<HTMLAnchorElement>>;
  
  constructor(private router: Router, private agentService: AgentMonitorService) {
    this.connectionStatus$ = this.agentService.isConnected();
    // Listen for route changes to update underline position
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        // Use setTimeout to ensure DOM is updated with active classes
        setTimeout(() => this.updateUnderlinePosition(), 50);
      });
  }
  
  ngAfterViewInit() {
    // Initialize underline position after view is ready
    setTimeout(() => this.updateUnderlinePosition(), 100);
  }
  
  onNavLinkClick(event: Event) {
    const clickedElement = event.target as HTMLAnchorElement;
    this.animateUnderlineToElement(clickedElement);
  }
  
  private updateUnderlinePosition() {
    const activeLink = this.navLinkElements.find(
      linkRef => linkRef.nativeElement.classList.contains('active')
    );
    
    if (activeLink && this.navUnderline) {
      this.animateUnderlineToElement(activeLink.nativeElement);
    }
  }
  
  private animateUnderlineToElement(targetElement: HTMLAnchorElement) {
    if (!this.navUnderline || !this.navLinks) return;
    
    const navLinksContainer = this.navLinks.nativeElement;
    const underlineElement = this.navUnderline.nativeElement;
    
    const containerRect = navLinksContainer.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    
    const leftOffset = targetRect.left - containerRect.left;
    const width = targetRect.width;
    
    // Apply the transform and width changes
    underlineElement.style.transform = `translateX(${leftOffset}px)`;
    underlineElement.style.width = `${width}px`;
  }
}
