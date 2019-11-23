"use strict";

var Service, Characteristic, detectedState, notDetectedState;
var ping = require('ping');
var moment = require('moment');


// Update UI immediately after sensor state change
var updateUI = false;

module.exports = function(homebridge) {

	// Service and Characteristic are from hap-nodejs
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	homebridge.registerPlatform('homebridge-ping-hosts', 'PingHosts', PingHostsPlatform);
	homebridge.registerAccessory('homebridge-ping-hosts', 'PingHostsContact', PingHostsContactAccessory);
    
	detectedState = Characteristic.ContactSensorState.CONTACT_DETECTED; // Closed
	notDetectedState = Characteristic.ContactSensorState.CONTACT_NOT_DETECTED; // Open

};

function PingHostsPlatform(log, config) {

	this.log = log;
    
    this.sensors = config['sensors'] || [];
    this.cacheDirectory = config["cacheDirectory"] || HomebridgeAPI.user.persistPath();

    //allow to save status of ping
    this.storage = require('node-persist');
    this.storage.initSync({dir:this.cacheDirectory});
    // Allow retrieval of data from package.json
	this.pkginfo = require('pkginfo')(module);

}

PingHostsPlatform.prototype = {

    accessories: function(callback) {

        var accessories = [];

        for (var i = 0; i < this.sensors.length; i++) {
            var sensorAccessory = new PingHostsContactAccessory(this, this.log, this.sensors[i]);
            accessories.push(sensorAccessory);
        }

        var accessoriesCount = accessories.length;
        
        this.log(callback);

        callback(accessories);

    }
    
}

function PingHostsContactAccessory(platform, log, config) {

    this.log = log;
    this.pkginfo = platform.pkginfo;

    this.id = config['id'];
    this.name = config['name'] || 'Host Ping Sensor';
    this.host = config['host'] || 'localhost';
    this.platform = platform;
    this.pingInterval = parseInt(config['interval']) || 300;
    this.threshold = config['threshold'] || -1;

    
	// Initial state
	this.stateValue = detectedState;

	this._service = new Service.ContactSensor(this.name);
	
	// Default state is open, we want it to be closed
	this._service.getCharacteristic(Characteristic.ContactSensorState)
		.setValue(this.stateValue);
		
	this._service
		.getCharacteristic(Characteristic.ContactSensorState)
		.on('get', this.getState.bind(this));
		
	this._service.addCharacteristic(Characteristic.StatusFault);
	
	this.changeHandler = (function(newState) {
		
		this.log('[' + this.name + '] Setting sensor state set to ' + newState);
		this._service.getCharacteristic(Characteristic.ContactSensorState)
			.setValue(newState ? detectedState : notDetectedState);
			
		if (updateUI)
			this._service.getCharacteristic(Characteristic.ContactSensorState)
				.getValue();
		
	}).bind(this);

	this.doPing();
	setInterval(this.doPing.bind(this), this.pingInterval * 1000);

}

PingHostsContactAccessory.prototype = {

	doPing: function() {
		
		var self = this;
		var lastState = self.stateValue;

		ping.promise.probe(self.host)
			.then(function (res, err) {
				
				if (err) {

					self.log(err);
					self.stateValue = notDetectedState;
					self.setStatusFault(1);
					
				} else {

					self.stateValue = res.alive ? detectedState : notDetectedState;
					self.setStatusFault(0);
					// self.log('[' + self.name + '] Ping result for ' + self.host + ' was ' + res.alive);

				}
			
				// Notify of state change, if applicable
				if (self.stateValue != lastState){

					//if treshold not set or exceed
					if(self.treshold === -1 || self.checkThreshold()){

						self.changeHandler(self.stateValue);
						self.platform.storage.setItemSync('lastPing_' + self.id, Date.now());

					}

				}else{

					self.platform.storage.setItemSync('lastPing_' + self.id, '');
				
				}

			});

	},
	
	checkThreshold: function(){

		var self = this;

	    var lastPing = self.platform.storage.getItemSync('lastPing_' + self.id);

	    if(!lastPing) {
	    
	    	self.platform.storage.setItemSync('lastPing_' + self.id, Date.now());
	        return false;
	    
	    }else {
	    
	        var currentMoment = moment();
	        var activeThreshold = moment(lastPing).add(self.threshold, 's');
	        
			self.log( '[' + self.name + '] Check cache status - currentMoment: ' + currentMoment.format() + ' activeThreshold:' + activeThreshold.format() );

	    	    	return currentMoment.isAfter(activeThreshold);

	    	}

	},

	setStatusFault: function(value) {
		
		this._service.setCharacteristic(Characteristic.StatusFault, value);	
		
	},

	identify: function(callback) {

		this.log('[' + this.name + '] Identify sensor requested');
		callback();

	},

	getState: function(callback) {

		this.log('[' + this.name + '] Getting sensor state, which is currently ' + this.stateValue);
		callback(null, this.stateValue);

	},

	getServices: function() {

		var informationService = new Service.AccessoryInformation();

		// Set plugin information
		informationService
			.setCharacteristic(Characteristic.Manufacturer, 'jsWorks')
			.setCharacteristic(Characteristic.Model, 'Ping State Sensor')
			.setCharacteristic(Characteristic.SerialNumber, 'Version ' + module.exports.version);

		return [informationService, this._service];

	}

};