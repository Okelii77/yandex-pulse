#include <stdio.h>
#include <sys/resource.h>
#include <string.h>
int main(void){struct rusage r;getrusage(RUSAGE_SELF,&r);printf("ru_maxrss_kib=%ld\n",r.ru_maxrss);FILE*f=fopen("/proc/self/status","r");char line[256];while(fgets(line,sizeof(line),f))if(!strncmp(line,"VmHWM:",6)||!strncmp(line,"VmRSS:",6))fputs(line,stdout);fclose(f);return 0;}
