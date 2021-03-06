﻿(function () {
    'use strict';
    angular.module('gym')
        .controller('WorkoutSessionCtrl', WorkoutSessionCtrl);

    WorkoutSessionCtrl.$inject = ['$log', '$mdConstant', '$routeParams', '$scope', '$mdDialog', '$q', 'tools', 'header', 'massUnits', 'workoutsService', 'exerciseSetsService', 'workoutSessionsService', 'nonameService', 'exercisesService'];
    function WorkoutSessionCtrl($log, $mdConstant, $routeParams, $scope, $mdDialog, $q, tools, header, massUnits, workoutsService, exerciseSetsService, workoutSessionsService, nonameService, exercisesService) {
        $log.log("gym.WorkoutSessionCtrl constructor");

        header.canGoBack = true;

        var self = this;

        self.workoutId = $routeParams.workoutId;
        self.sessionId = $routeParams.sessionId;
        self.workout = {};
        self.workoutSession = null;
        self.nonSavedSet = null;
        self.isRequestingHistory = false;

        // MODEL properties
        self.activeExercise = {};       // View: to expand current exercise
        self.exercises = [];            // View: list of exercises
        self.exerciseSets = [];         // View: list of sets of exercises
        self.massUnits = massUnits;     // View: dropdown list
        self.accomplishedExercises = {};// View: hash-table of accomplished exercises

        // MODEL methods
        self.setActiveExercise = setActiveExercise;
        self.filterExerciseSets = filterExerciseSets;
        self.showHistory = showHistory;
        self.showFeedback = showFeedback;
        self.onKeydown = onKeydown;
        self.onChange = onChange;
        self.onBlur = onBlur;
        self.onUnitChange = onUnitChange;

        $scope.$on('$destroy', onDestroy);

        workoutSessionsService
            .get({ '$filter': `id eq ${self.sessionId}` }, {}
            , (result) => {
                result.value && result.value.length
                        ? continueWorkoutSession(result.value[0])
                        : startNewWorkoutSession();
            }
            , () => { throw "Failed to obtain workout session"; });

        function continueWorkoutSession(session) {
            setWorkoutSession(session);
            var exerciseSets = session.exerciseSets;
            workoutsService
                .query({ id: self.workoutId }
                , onWorkoutObtained);
        }

        function setWorkoutSession(session) {
            if (session) {
                self.workoutSession = new WorkoutSession(session);
            }
            else {
                self.workoutSession = new WorkoutSession({
                    dateStart: new Date(),
                    dateEnd: null,
                    id: self.sessionId
                });
                workoutSessionsService.save(self.workoutSession);
            }
            nonameService.workoutStartTime = new Date(self.workoutSession.dateStart).setMinutes(self.workoutSession.dateStart.getMinutes() - self.workoutSession.dateStart.getTimezoneOffset());
        }

        function startNewWorkoutSession() {
            setWorkoutSession();
            workoutsService
                .query({ id: self.workoutId }
                , onWorkoutObtained);
        }

        function onWorkoutObtained(workout) {
            setWorkout(workout);
            setExercises(workout);
            setExerciseSets(workout);
            setActiveExercise(self.exercises[0]);
        }

        function setWorkout(workout) {
            header.title = workout.name;
            self.workout = workout;
        }

        function setExercises(workout) {
            self.exercises = workout.exercises;
        }

        function setExerciseSets(workout) {
            var workoutSessionId = self.workoutSession.id;
            var sets = self.workoutSession.exerciseSets;

            if (sets && sets.length) {
                workout.exercises.forEach(function (ex, index) {
                    if (!sets.some(set => set.exerciseId === ex.id)) {
                        sets.push(new ExerciseSet({
                            exerciseId: ex.id,
                            workoutId: workout.id,
                            workoutSessionId: workoutSessionId,
                            weight: null,
                            unit: 'kg',
                            serialNumber: 0,
                            numberOfRepetitions: null
                        }));
                    } else {
                        self.accomplishedExercises[ex.id] = true;
                    }
                });
            }
            else {
                sets = [];
                workout.exercises.forEach(function (ex, index) {
                    sets.push(new ExerciseSet({
                        exerciseId: ex.id,
                        workoutId: workout.id,
                        workoutSessionId: workoutSessionId,
                        weight: null,
                        unit: 'kg',
                        serialNumber: 0,
                        numberOfRepetitions: null
                    }));
                });
            }
            self.exerciseSets = sets;
            sets = null;
        }

        function filterExerciseSets(exercise, exerciseId) {
            if (exercise && exercise.id) {
                return exercise.id === exerciseId;
            }
            else {
                return angular.equals(exercise, exerciseId);
            }
        }

        function setActiveExercise(exercise, ev) {
            if (exercise || !ev.path.some(function (el) { return el instanceof HTMLFormElement; }))
                self.activeExercise = exercise;
        }

        function onDestroy() {
            endWorkoutSession();
        }

        function endWorkoutSession() {
            saveLastEditedSet();
            self.workoutSession.dateEnd = new Date();
            delete self.workoutSession.exerciseSets;
            workoutSessionsService.update(self.workoutSession);
            nonameService.workoutStartTime = new Date(0);
        }

        function saveLastEditedSet() {
            if (self.nonSavedSet) {
                updateExerciseSet(self.nonSavedSet);
                self.nonSavedSet = null;
            }
        }

        function showHistory(ev, exercise) {
            cancelBubble(ev);
            self.isRequestingHistory = true;
            var workoutSessionId = self.workoutSession.id;
            var exerciseName = exercise.name;
            getExerciseHistory(exercise.id, workoutSessionId)
                .then(function (exerciseSets) {
                    $mdDialog.show({
                        controller: ExerciseSetOneExerciseCtrl,
                        controllerAs: 'ctrl',
                        templateUrl: 'app/partials/exerciseset-one-exercise.html',
                        parent: angular.element(document.body),
                        targetEvent: ev,
                        clickOutsideToClose: true,
                        fullscreen: false,
                        locals: {
                            exerciseSets: exerciseSets,
                            exerciseName: exerciseName
                        }
                    });
                }, function onReject(data) { $log.warn(data.message); })
                .finally(function () {
                    self.isRequestingHistory = false;
                });
        }

        function getExerciseHistory(exerciseId, workoutSessionId) {
            var deferred = $q.defer();
            exerciseSetsService.getPrevExerciseSessionId({
                exerciseId: exerciseId,
                workoutSessionId: workoutSessionId
            },
            function (data) {
                if (data && data.value) {
                    if (data.value.length) {
                        exerciseSetsService.getExercisesSetsFromSession({
                            exerciseId: exerciseId,
                            workoutSessionId: data.value[0].workoutSessionId
                        },
                        function (data) {
                            if (data && data.value && data.value.length) {
                                deferred.resolve(data.value);
                            } else {
                                deferred.reject({ message: 'No previous exercise sets are available' });
                            }
                        });
                    }
                    else {
                        deferred.reject({ message: 'No previous exercise sets are available' });
                    }
                }
            });
            return deferred.promise;
        }

        function showFeedback(ev, exercise, textContent) {
            cancelBubble(ev);
            var exerciseName = exercise.name;
            var confirm = $mdDialog.prompt()
              .title(`${exercise.name} feedback`)
              .textContent(textContent || "How do you feel?")
              .placeholder('Feedback')
              .ariaLabel("How do you feel?")
              .initialValue(exercise.feedback)
              .targetEvent(ev)
              .cancel('Cancel')
              .ok('OK');

            $mdDialog.show(confirm).then(function (result) {
                exercisesService.update({ id: exercise.id }, angular.merge({}, exercise, { feedback: result }), function () {
                    exercise.feedback = result;
                    $log.info('saved');
                },
                function (response) {
                    if (response.data.error && response.data.error.innererror && response.data.error.innererror.message) {
                        showFeedback(ev, exercise, response.data.error.innererror.message);
                    }
                });
            }, function () { });
        }

        function onKeydown(event, exerciseId) {
            switch (event.keyCode) {
                case $mdConstant.KEY_CODE.ENTER:
                    addOneMoreSet(exerciseId);
                    break;
                case $mdConstant.KEY_CODE.TAB:
                    if (!event.shiftKey)
                        addOneMoreSet(exerciseId);
                    break;
                default:
            }
        }

        function addOneMoreSet(exerciseId) {
            console.log('addOneMoreSet', exerciseId);
            // if all the sets are filled in
            if (!self.exerciseSets.some(set => set.exerciseId === exerciseId && isSetEmpty(set))) {
                var currentExerciseSets = self.exerciseSets.filter(set => set.exerciseId === exerciseId);
                var lastSet = currentExerciseSets[currentExerciseSets.length - 1];
                lastSet.date = new Date();
                var workoutSessionId = self.workoutSession.id;

                self.exerciseSets.push(new ExerciseSet({
                    exerciseId: lastSet.exerciseId,
                    workoutId: lastSet.workoutId,
                    workoutSessionId: workoutSessionId,
                    weight: null,
                    unit: lastSet.unit,
                    serialNumber: currentExerciseSets.length,
                    numberOfRepetitions: null
                }));
            }
        }

        function onChange(set) {
            self.nonSavedSet = set;
        }

        function onBlur(set) {
            updateExerciseSet(set);
        }

        function onUnitChange(set) {
            updateExerciseSet(set);
        }

        function updateExerciseSet(set) {
            if (isSetFilled(set)) {
                saveExerciseSet(set);
            } else if (isSetEmpty(set)) {
                deleteExerciseSet(set);
            }
            self.nonSavedSet = null;
        }

        function saveExerciseSet(set) {
            self.accomplishedExercises[set.exerciseId] = true;
            if (!set.id) {
                set.id = tools.guid();
                return exerciseSetsService.save(set);
            } else {
                return exerciseSetsService.update(set);
            }
        }

        function deleteExerciseSet(set) {
            var setId = set.id;
            if (setId) {
                exerciseSetsService.remove({
                    id: setId
                });
            }
            if (self.exerciseSets.filter(s => s.exerciseId === set.exerciseId).length > 1) {
                var index = self.exerciseSets.indexOf(set);
                self.exerciseSets.splice(index, 1);
            } else {
                set.id = null;
                self.accomplishedExercises[set.exerciseId] = false;
            }
        }

        function areAllExerciseSetsFilled(sets) {
            if (!sets) {
                return false;
            }
            return sets.every(function (set) {
                return isSetFilled(set);
            });
        }
        function isSetFilled(set) {
            return set.weight > 0 && set.numberOfRepetitions > 0;
        }
        function isSetEmpty(set) {
            return !set.weight && !set.numberOfRepetitions;
        }

        function cancelBubble(e) {
            var evt = e ? e : window.event;
            if (evt.stopPropagation) evt.stopPropagation();
            if (evt.cancelBubble !== null) evt.cancelBubble = true;
        }
    }
    angular.module('gym')
        .controller('ExerciseSetOneExerciseCtrl', ExerciseSetOneExerciseCtrl);

    ExerciseSetOneExerciseCtrl.$inject = ['$mdDialog', 'exerciseName', 'exerciseSets'];
    function ExerciseSetOneExerciseCtrl($mdDialog, exerciseName, exerciseSets) {
        var self = this;
        self.exerciseName = exerciseName;
        self.exerciseSets = exerciseSets;
        self.hide = function () {
            $mdDialog.hide();
        };
        self.cancel = function () {
            $mdDialog.cancel();
        };
    }

    function ExerciseSet(args) {
        this.id = args.id;
        this.date = args.date instanceof Date ? args.date : new Date(args.date);
        this.rowVersion = args.rowVersion;
        this.exerciseId = args.exerciseId;
        this.workoutId = args.workoutId;
        this.workoutSessionId = args.workoutSessionId;
        this.weight = args.weight;
        this.unit = args.unit;
        this.serialNumber = args.serialNumber;
        this.numberOfRepetitions = args.numberOfRepetitions;
    }

    function WorkoutSession(args) {
        this.id = args.id;
        this.dateStart = args.dateStart instanceof Date ? args.dateStart : new Date(args.dateStart);
        this.dateEnd = args.dateEnd instanceof Date ? args.dateEnd : new Date(args.dateEnd);
        this.rowVersion = args.rowVersion;
        this.exerciseSets = args.exerciseSets;
    }
})();
